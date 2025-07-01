#!/usr/bin/env node

/**
 * Тест динамических инструментов MCP сервера
 * Проверяет что после авторизации сервер показывает все процессоры как отдельные инструменты
 */

import { spawn } from 'child_process';

async function testDynamicTools() {
    console.log('🔍 Тест динамических инструментов MCP сервера');

    return new Promise((resolve, reject) => {
        const mcpServer = spawn('node', ['dist/index.js'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd()
        });

        let serverReady = false;
        let authCompleted = false;
        let toolsBeforeAuth = [];
        let toolsAfterAuth = [];
        let testedDynamicTool = false;

        mcpServer.stderr.on('data', (data) => {
            const message = data.toString().trim();
            console.log('📡 Server stderr:', message);

            if (message.includes('MODX Proxy MCP Server running on stdio')) {
                serverReady = true;
                console.log('✅ MCP сервер запущен');
                startTests();
            }
        });

        mcpServer.stdout.on('data', (data) => {
            const output = data.toString().trim();
            const lines = output.split('\n').filter(line => line.trim());

            for (const line of lines) {
                try {
                    const response = JSON.parse(line);

                    if (response.result) {
                        // List tools response
                        if (response.result.tools && response.id === 1) {
                            toolsBeforeAuth = response.result.tools;
                            console.log(`✅ Инструменты ДО авторизации: ${toolsBeforeAuth.length}`);
                            toolsBeforeAuth.forEach(tool => {
                                console.log(`   - ${tool.name}: ${tool.description}`);
                            });
                            performLogin();
                        }

                        // Login response
                        else if (response.result.content && response.id === 2) {
                            const content = JSON.parse(response.result.content[0].text);
                            if (content.success && content.user && !authCompleted) {
                                console.log('✅ Авторизация успешна');
                                authCompleted = true;
                                getToolsAfterAuth();
                            }
                        }

                        // Tools after auth
                        else if (response.result.tools && response.id === 3) {
                            toolsAfterAuth = response.result.tools;
                            console.log(`✅ Инструменты ПОСЛЕ авторизации: ${toolsAfterAuth.length}`);

                            // Показываем первые несколько динамических инструментов
                            const dynamicTools = toolsAfterAuth.filter(tool =>
                                tool.name.startsWith('modx_') &&
                                !['modx_login', 'modx_logout', 'modx_get_session_info'].includes(tool.name)
                            );

                            console.log(`   Динамических инструментов: ${dynamicTools.length}`);
                            console.log('   Примеры динамических инструментов:');
                            dynamicTools.slice(0, 5).forEach(tool => {
                                console.log(`   - ${tool.name}: ${tool.description}`);
                            });

                            testDynamicTool();
                        }

                        // Dynamic tool test response
                        else if (response.result.content && response.id === 4) {
                            const content = JSON.parse(response.result.content[0].text);
                            console.log('✅ Динамический инструмент modx_core_resource_getlist протестирован');
                            console.log('   Success:', content.success);
                            if (content.results && content.results.length > 0) {
                                console.log(`   Найдено ресурсов: ${content.results.length}`);
                                console.log(`   Первый ресурс: ID=${content.results[0].id}, Title="${content.results[0].pagetitle}"`);
                            }
                            testedDynamicTool = true;
                            testCompleted();
                        }
                    }
                } catch (e) {
                    // Игнорируем не-JSON строки
                }
            }
        });

        function sendRequest(id, method, params = {}) {
            const request = {
                jsonrpc: "2.0",
                id: id,
                method: method,
                params: params
            };
            console.log('📤 Отправка запроса:', JSON.stringify(request));
            mcpServer.stdin.write(JSON.stringify(request) + '\n');
        }

        function startTests() {
            setTimeout(() => {
                console.log('\n📡 Тест 1: Получение инструментов ДО авторизации');
                sendRequest(1, 'tools/list');
            }, 1000);
        }

        function performLogin() {
            setTimeout(() => {
                console.log('\n📡 Тест 2: Авторизация');
                sendRequest(2, 'tools/call', {
                    name: 'modx_login',
                    arguments: {
                        username: 'admin',
                        password: 'adminadmin',
                        baseUrl: 'http://claude-modx-mcp.my'
                    }
                });
            }, 1000);
        }

        function getToolsAfterAuth() {
            setTimeout(() => {
                console.log('\n📡 Тест 3: Получение инструментов ПОСЛЕ авторизации');
                sendRequest(3, 'tools/list');
            }, 2000); // Даем время для загрузки процессоров
        }

        function testDynamicTool() {
            setTimeout(() => {
                console.log('\n📡 Тест 4: Вызов динамического инструмента modx_core_resource_getlist');
                sendRequest(4, 'tools/call', {
                    name: 'modx_core_resource_getlist',
                    arguments: {
                        limit: 3,
                        start: 0
                    }
                });
            }, 1000);
        }

        function testCompleted() {
            console.log('\n🎉 Тестирование динамических инструментов завершено!');
            console.log('\n📊 Результаты:');
            console.log(`   Инструментов до авторизации: ${toolsBeforeAuth.length}`);
            console.log(`   Инструментов после авторизации: ${toolsAfterAuth.length}`);
            console.log(`   Добавлено динамических инструментов: ${toolsAfterAuth.length - toolsBeforeAuth.length}`);
            console.log(`   Динамический инструмент работает: ${testedDynamicTool ? 'ДА' : 'НЕТ'}`);

            mcpServer.kill();
            resolve(true);
        }

        mcpServer.on('error', (error) => {
            console.error('❌ Ошибка MCP сервера:', error);
            reject(error);
        });

        mcpServer.on('exit', (code) => {
            console.log(`📡 MCP сервер завершен с кодом: ${code}`);
            if (!testedDynamicTool) {
                reject(new Error('Тест не завершен'));
            }
        });

        setTimeout(() => {
            if (!testedDynamicTool) {
                console.log('⏰ Таймаут теста');
                mcpServer.kill();
                reject(new Error('Timeout'));
            }
        }, 60000);
    });
}

testDynamicTools()
    .then(() => {
        console.log('\n✅ Тест динамических инструментов завершен успешно');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Ошибка теста:', error);
        process.exit(1);
    });
