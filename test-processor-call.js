#!/usr/bin/env node

/**
 * Тест вызова конкретного процессора через MCP сервер
 */

import { spawn } from 'child_process';

async function testProcessorCall() {
    console.log('🔍 Тест вызова процессора resource/getlist через MCP сервер');

    return new Promise((resolve, reject) => {
        const mcpServer = spawn('node', ['dist/index.js'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd()
        });

        let serverReady = false;
        let authCompleted = false;
        let processorCalled = false;

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
            
            // Пытаемся парсить каждую строку как JSON
            const lines = output.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                try {
                    const response = JSON.parse(line);
                    
                    if (response.result && response.result.content) {
                        const content = JSON.parse(response.result.content[0].text);
                        
                        if (content.success && content.user && !authCompleted) {
                            console.log('✅ Авторизация успешна');
                            authCompleted = true;
                            testCallProcessor();
                        } else if (response.id === 3 && !processorCalled) {
                            console.log('✅ Процессор resource/getlist вызван');
                            console.log('   Success:', content.success);
                            if (content.results && content.results.length > 0) {
                                console.log(`   Найдено ресурсов: ${content.results.length}`);
                                console.log(`   Первый ресурс: ID=${content.results[0].id}, Title="${content.results[0].pagetitle}"`);
                            }
                            processorCalled = true;
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
                console.log('\n📡 Тест 1: Авторизация');
                sendRequest(1, 'tools/call', {
                    name: 'modx_login',
                    arguments: {
                        username: 'admin',
                        password: 'adminadmin',
                        baseUrl: 'http://claude-modx-mcp.my'
                    }
                });
            }, 1000);
        }

        function testCallProcessor() {
            setTimeout(() => {
                console.log('\n📡 Тест 2: Вызов процессора resource/getlist');
                sendRequest(3, 'tools/call', {
                    name: 'modx_call_processor',
                    arguments: {
                        namespace: 'core',
                        action: 'resource/getlist',
                        data: {
                            limit: 3,
                            start: 0
                        }
                    }
                });
            }, 1000);
        }

        function testCompleted() {
            console.log('\n🎉 Тест вызова процессора завершен успешно!');
            mcpServer.kill();
            resolve(true);
        }

        mcpServer.on('error', (error) => {
            console.error('❌ Ошибка MCP сервера:', error);
            reject(error);
        });

        mcpServer.on('exit', (code) => {
            console.log(`📡 MCP сервер завершен с кодом: ${code}`);
            if (!processorCalled) {
                reject(new Error('Тест не завершен'));
            }
        });

        setTimeout(() => {
            if (!processorCalled) {
                console.log('⏰ Таймаут теста');
                mcpServer.kill();
                reject(new Error('Timeout'));
            }
        }, 20000);
    });
}

testProcessorCall()
    .then(() => {
        console.log('\n✅ Тест вызова процессора завершен успешно');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Ошибка теста:', error);
        process.exit(1);
    });