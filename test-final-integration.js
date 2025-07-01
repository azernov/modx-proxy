#!/usr/bin/env node

/**
 * Финальный тест интеграции MCP сервера с собственным коннектором
 */

import { spawn } from 'child_process';
import { createWriteStream } from 'fs';

async function testMcpIntegration() {
    console.log('🔍 Финальный тест интеграции MCP сервера');

    return new Promise((resolve, reject) => {
        // Запускаем MCP сервер
        const mcpServer = spawn('node', ['dist/index.js'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd()
        });

        let serverReady = false;
        let authCompleted = false;
        let processorsReceived = false;

        // Обработка stderr для отслеживания запуска сервера
        mcpServer.stderr.on('data', (data) => {
            const message = data.toString().trim();
            console.log('📡 Server stderr:', message);
            
            if (message.includes('MODX Proxy MCP Server running on stdio')) {
                serverReady = true;
                console.log('✅ MCP сервер запущен');
                startTests();
            }
        });

        // Обработка stdout для получения ответов
        mcpServer.stdout.on('data', (data) => {
            try {
                const response = JSON.parse(data.toString().trim());
                console.log('📥 Server response:', JSON.stringify(response, null, 2));
                
                // Анализируем ответ
                if (response.result && response.result.content) {
                    const content = JSON.parse(response.result.content[0].text);
                    
                    if (content.success && content.user && !authCompleted) {
                        console.log('✅ Авторизация успешна');
                        authCompleted = true;
                        testGetProcessors();
                    } else if (content.success && content.processors && !processorsReceived) {
                        console.log('✅ Список процессоров получен');
                        console.log(`   Найдено процессоров: ${content.total}`);
                        console.log(`   Дата генерации: ${content.generated_at}`);
                        processorsReceived = true;
                        testCompleted();
                    }
                }
            } catch (e) {
                console.log('📥 Server output (не JSON):', data.toString().trim());
            }
        });

        // Функция для отправки JSON-RPC запросов
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

        // Начинаем тесты
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

        // Тест получения процессоров
        function testGetProcessors() {
            setTimeout(() => {
                console.log('\n📡 Тест 2: Получение списка процессоров');
                sendRequest(2, 'tools/call', {
                    name: 'modx_get_processors',
                    arguments: {
                        refresh: false
                    }
                });
            }, 1000);
        }

        // Завершение тестов
        function testCompleted() {
            console.log('\n🎉 Все тесты завершены успешно!');
            mcpServer.kill();
            resolve(true);
        }

        // Обработка ошибок
        mcpServer.on('error', (error) => {
            console.error('❌ Ошибка MCP сервера:', error);
            reject(error);
        });

        mcpServer.on('exit', (code) => {
            console.log(`📡 MCP сервер завершен с кодом: ${code}`);
            if (!processorsReceived) {
                reject(new Error('Тесты не завершены'));
            }
        });

        // Таймаут для тестов
        setTimeout(() => {
            if (!processorsReceived) {
                console.log('⏰ Таймаут тестов');
                mcpServer.kill();
                reject(new Error('Timeout'));
            }
        }, 30000);
    });
}

testMcpIntegration()
    .then(() => {
        console.log('\n✅ Интеграционный тест завершен успешно');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Ошибка интеграционного теста:', error);
        process.exit(1);
    });