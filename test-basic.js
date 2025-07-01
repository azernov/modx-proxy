#!/usr/bin/env node

/**
 * Простой тест MODX MCP сервера через stdin/stdout
 * Для быстрой проверки базовой функциональности
 */

import { spawn } from 'child_process';

class BasicMcpTester {
    constructor() {
        this.tests = [];
    }

    log(message) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    addTest(name, success, details = '') {
        this.tests.push({ name, success, details });
    }

    async testMcpCommand(command) {
        return new Promise((resolve, reject) => {
            this.log(`Выполнение команды: ${command.params.name}`);
            
            const mcpServer = spawn('node', ['dist/index.js'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            let error = '';

            mcpServer.stdout.on('data', (data) => {
                output += data.toString();
            });

            mcpServer.stderr.on('data', (data) => {
                error += data.toString();
            });

            mcpServer.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(output);
                        resolve(result);
                    } catch (e) {
                        reject(new Error(`Invalid JSON output: ${output}`));
                    }
                } else {
                    reject(new Error(`Process exited with code ${code}. Error: ${error}`));
                }
            });

            mcpServer.on('error', (err) => {
                reject(err);
            });

            // Отправляем команду
            mcpServer.stdin.write(JSON.stringify(command) + '\n');
            mcpServer.stdin.end();

            // Таймаут
            setTimeout(() => {
                mcpServer.kill();
                reject(new Error('Command timeout'));
            }, 30000);
        });
    }

    async testLogin() {
        this.log('=== Тест авторизации ===');
        
        const command = {
            method: 'tools/call',
            params: {
                name: 'modx_login',
                arguments: {
                    username: process.env.MODX_USERNAME || 'admin',
                    password: process.env.MODX_PASSWORD || 'password',
                    baseUrl: process.env.MODX_BASE_URL || 'http://localhost'
                }
            }
        };

        try {
            const result = await this.testMcpCommand(command);
            
            if (result.content && result.content[0]) {
                const response = JSON.parse(result.content[0].text);
                
                if (response.success) {
                    this.log('✅ Авторизация успешна');
                    this.log(`   Пользователь: ${response.user?.username || 'unknown'}`);
                    this.addTest('Авторизация', true, `Пользователь: ${response.user?.username}`);
                    return true;
                } else {
                    this.log(`❌ Авторизация неудачна: ${response.message}`);
                    this.addTest('Авторизация', false, response.message);
                    return false;
                }
            } else {
                this.log('❌ Неверный формат ответа');
                this.addTest('Авторизация', false, 'Неверный формат ответа');
                return false;
            }
        } catch (error) {
            this.log(`❌ Ошибка авторизации: ${error.message}`);
            this.addTest('Авторизация', false, error.message);
            return false;
        }
    }

    async testGetProcessors() {
        this.log('\n=== Тест получения процессоров ===');
        
        const command = {
            method: 'tools/call',
            params: {
                name: 'modx_get_processors',
                arguments: {}
            }
        };

        try {
            const result = await this.testMcpCommand(command);
            
            if (result.content && result.content[0]) {
                const response = JSON.parse(result.content[0].text);
                
                if (response.success && response.processors) {
                    this.log(`✅ Получено процессоров: ${response.total}`);
                    this.log(`   Сгенерирован: ${response.generated_at}`);
                    
                    // Покажем первые несколько процессоров
                    this.log('   Примеры:');
                    response.processors.slice(0, 3).forEach(proc => {
                        this.log(`     - ${proc.namespace}/${proc.path}`);
                    });
                    
                    this.addTest('Получение процессоров', true, `${response.total} процессоров`);
                    return true;
                } else {
                    this.log(`❌ Ошибка: ${response.message || 'неизвестная ошибка'}`);
                    this.addTest('Получение процессоров', false, response.message);
                    return false;
                }
            } else {
                this.log('❌ Неверный формат ответа');
                this.addTest('Получение процессоров', false, 'Неверный формат ответа');
                return false;
            }
        } catch (error) {
            this.log(`❌ Ошибка: ${error.message}`);
            this.addTest('Получение процессоров', false, error.message);
            return false;
        }
    }

    async testResourceList() {
        this.log('\n=== Тест получения ресурсов ===');
        
        const command = {
            method: 'tools/call',
            params: {
                name: 'modx_call_processor',
                arguments: {
                    namespace: 'core',
                    action: 'resource/getlist',
                    data: {
                        limit: 3,
                        start: 0
                    }
                }
            }
        };

        try {
            const result = await this.testMcpCommand(command);
            
            if (result.content && result.content[0]) {
                const response = JSON.parse(result.content[0].text);
                
                if (response.success !== false) {
                    this.log('✅ Процессор resource/getlist выполнен');
                    
                    let resources = response.results || response.data || [];
                    if (Array.isArray(resources)) {
                        this.log(`   Найдено ресурсов: ${resources.length}`);
                        resources.forEach(res => {
                            this.log(`     - ID: ${res.id}, "${res.pagetitle}"`);
                        });
                        this.addTest('Получение ресурсов', true, `${resources.length} ресурсов`);
                    } else {
                        this.log('   Ответ получен, но нет списка ресурсов');
                        this.addTest('Получение ресурсов', true, 'Ответ получен');
                    }
                    return true;
                } else {
                    this.log(`❌ Ошибка процессора: ${response.message || 'неизвестная'}`);
                    this.addTest('Получение ресурсов', false, response.message);
                    return false;
                }
            } else {
                this.log('❌ Неверный формат ответа');
                this.addTest('Получение ресурсов', false, 'Неверный формат ответа');
                return false;
            }
        } catch (error) {
            this.log(`❌ Ошибка: ${error.message}`);
            this.addTest('Получение ресурсов', false, error.message);
            return false;
        }
    }

    async testSessionInfo() {
        this.log('\n=== Тест информации о сессии ===');
        
        const command = {
            method: 'tools/call',
            params: {
                name: 'modx_get_session_info',
                arguments: {}
            }
        };

        try {
            const result = await this.testMcpCommand(command);
            
            if (result.content && result.content[0]) {
                const response = JSON.parse(result.content[0].text);
                
                if (response.isAuthenticated) {
                    this.log('✅ Сессия активна');
                    this.log(`   Base URL: ${response.baseUrl}`);
                    this.addTest('Информация о сессии', true, 'Сессия активна');
                    return true;
                } else {
                    this.log('❌ Сессия неактивна');
                    this.addTest('Информация о сессии', false, 'Сессия неактивна');
                    return false;
                }
            } else {
                this.log('❌ Неверный формат ответа');
                this.addTest('Информация о сессии', false, 'Неверный формат ответа');
                return false;
            }
        } catch (error) {
            this.log(`❌ Ошибка: ${error.message}`);
            this.addTest('Информация о сессии', false, error.message);
            return false;
        }
    }

    showSummary() {
        this.log('\n' + '='.repeat(60));
        this.log('📊 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ');
        this.log('='.repeat(60));

        let passed = 0;
        let failed = 0;

        this.tests.forEach(test => {
            const status = test.success ? '✅' : '❌';
            this.log(`${status} ${test.name}: ${test.details}`);
            
            if (test.success) passed++;
            else failed++;
        });

        this.log('\n' + '-'.repeat(60));
        this.log(`Пройдено: ${passed}, Провалено: ${failed}, Всего: ${this.tests.length}`);
        
        if (failed === 0) {
            this.log('🎉 Все тесты пройдены успешно!');
        } else {
            this.log('⚠️  Есть проваленные тесты.');
        }
        
        this.log('='.repeat(60));
        return failed === 0;
    }

    async runAllTests() {
        this.log('🧪 Запуск тестов MODX MCP сервера');
        this.log(`Base URL: ${process.env.MODX_BASE_URL || 'http://localhost'}`);
        this.log(`Username: ${process.env.MODX_USERNAME || 'admin'}`);

        try {
            // Проверяем что сборка существует
            const fs = await import('fs');
            if (!fs.existsSync('dist/index.js')) {
                throw new Error('Сборка не найдена. Выполните: npm run build');
            }

            const loginSuccess = await this.testLogin();
            
            if (loginSuccess) {
                await this.testGetProcessors();
                await this.testResourceList();
                await this.testSessionInfo();
            } else {
                this.log('\n⚠️  Пропускаем остальные тесты из-за неудачной авторизации');
            }

        } catch (error) {
            this.log(`❌ Критическая ошибка: ${error.message}`);
            this.addTest('Критическая ошибка', false, error.message);
        }

        return this.showSummary();
    }
}

// Запуск тестов
async function main() {
    const tester = new BasicMcpTester();
    const success = await tester.runAllTests();
    process.exit(success ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('Ошибка выполнения тестов:', error);
        process.exit(1);
    });
}