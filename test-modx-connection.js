#!/usr/bin/env node

/**
 * Тест подключения к MODX Proxy MCP серверу
 * Проверяет авторизацию, получение списка процессоров и выполнение базовых операций
 */

import { spawn } from 'child_process';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

class ModxMcpTester {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || process.env.MODX_BASE_URL || 'http://localhost';
        this.username = options.username || process.env.MODX_USERNAME || 'admin';
        this.password = options.password || process.env.MODX_PASSWORD || 'password';
        this.connectorPath = options.connectorPath || process.env.MODX_CONNECTOR_PATH || '/connectors/';
        this.adminPath = options.adminPath || process.env.MODX_ADMIN_PATH || '/manager/';
        
        this.mcpProcess = null;
        this.testResults = [];
    }

    /**
     * Запустить MCP сервер
     */
    async startMcpServer() {
        console.log('🚀 Запуск MCP сервера...');
        
        return new Promise((resolve, reject) => {
            const args = [
                '--modx-base-url', this.baseUrl,
                '--modx-connector-path', this.connectorPath,
                '--modx-admin-path', this.adminPath,
                '--modx-username', this.username,
                '--modx-password', this.password
            ];

            this.mcpProcess = spawn('./start-mcp.sh', args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env }
            });

            let output = '';
            this.mcpProcess.stdout.on('data', (data) => {
                output += data.toString();
                if (output.includes('MODX Proxy MCP Server running on stdio')) {
                    console.log('✅ MCP сервер запущен');
                    resolve();
                }
            });

            this.mcpProcess.stderr.on('data', (data) => {
                console.error('MCP Server Error:', data.toString());
            });

            this.mcpProcess.on('error', (error) => {
                console.error('❌ Ошибка запуска MCP сервера:', error.message);
                reject(error);
            });

            this.mcpProcess.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`❌ MCP сервер завершился с кодом ${code}`);
                    reject(new Error(`MCP server exited with code ${code}`));
                }
            });

            // Таймаут на запуск
            setTimeout(() => {
                if (!output.includes('MODX Proxy MCP Server running on stdio')) {
                    reject(new Error('MCP server start timeout'));
                }
            }, 10000);
        });
    }

    /**
     * Остановить MCP сервер
     */
    stopMcpServer() {
        if (this.mcpProcess) {
            console.log('🛑 Остановка MCP сервера...');
            this.mcpProcess.kill();
            this.mcpProcess = null;
        }
    }

    /**
     * Отправить команду в MCP сервер
     */
    async sendMcpCommand(method, toolName, args = {}) {
        return new Promise((resolve, reject) => {
            if (!this.mcpProcess) {
                reject(new Error('MCP server not running'));
                return;
            }

            const request = {
                method: method,
                params: {
                    name: toolName,
                    arguments: args
                }
            };

            let output = '';
            let errorOutput = '';

            const timeout = setTimeout(() => {
                reject(new Error('Command timeout'));
            }, 30000);

            const onData = (data) => {
                output += data.toString();
                try {
                    const result = JSON.parse(output);
                    clearTimeout(timeout);
                    this.mcpProcess.stdout.off('data', onData);
                    this.mcpProcess.stderr.off('data', onError);
                    resolve(result);
                } catch (e) {
                    // Еще не полный JSON, продолжаем ждать
                }
            };

            const onError = (data) => {
                errorOutput += data.toString();
            };

            this.mcpProcess.stdout.on('data', onData);
            this.mcpProcess.stderr.on('data', onError);

            // Отправляем команду
            this.mcpProcess.stdin.write(JSON.stringify(request) + '\n');
        });
    }

    /**
     * Тест авторизации
     */
    async testLogin() {
        console.log('\n📋 Тест 1: Авторизация в MODX');
        
        try {
            const result = await this.sendMcpCommand('tools/call', 'modx_login', {
                username: this.username,
                password: this.password,
                baseUrl: this.baseUrl
            });

            if (result.content && result.content[0]) {
                const response = JSON.parse(result.content[0].text);
                
                if (response.success) {
                    console.log('✅ Авторизация успешна');
                    console.log(`   Пользователь: ${response.user?.username || 'неизвестен'}`);
                    console.log(`   Base URL: ${response.sessionInfo?.baseUrl}`);
                    this.addTestResult('login', true, 'Авторизация выполнена успешно');
                } else {
                    console.log('❌ Авторизация неудачна:', response.message);
                    this.addTestResult('login', false, response.message);
                }
            } else {
                console.log('❌ Неверный формат ответа при авторизации');
                this.addTestResult('login', false, 'Неверный формат ответа');
            }

        } catch (error) {
            console.log('❌ Ошибка при авторизации:', error.message);
            this.addTestResult('login', false, error.message);
        }
    }

    /**
     * Тест получения списка процессоров
     */
    async testGetProcessors() {
        console.log('\n📋 Тест 2: Получение списка процессоров');
        
        try {
            const result = await this.sendMcpCommand('tools/call', 'modx_get_processors', {});

            if (result.content && result.content[0]) {
                const response = JSON.parse(result.content[0].text);
                
                if (response.success && response.processors) {
                    console.log('✅ Список процессоров получен');
                    console.log(`   Всего процессоров: ${response.total}`);
                    console.log(`   Сгенерирован: ${response.generated_at}`);
                    
                    // Покажем несколько примеров процессоров
                    console.log('   Примеры процессоров:');
                    response.processors.slice(0, 5).forEach(processor => {
                        console.log(`     - ${processor.namespace}/${processor.path}`);
                    });
                    
                    this.addTestResult('get_processors', true, `Получено ${response.total} процессоров`);
                    return response.processors;
                } else {
                    console.log('❌ Ошибка получения процессоров:', response.message || 'неизвестная ошибка');
                    this.addTestResult('get_processors', false, response.message || 'неизвестная ошибка');
                }
            } else {
                console.log('❌ Неверный формат ответа при получении процессоров');
                this.addTestResult('get_processors', false, 'Неверный формат ответа');
            }

        } catch (error) {
            console.log('❌ Ошибка при получении процессоров:', error.message);
            this.addTestResult('get_processors', false, error.message);
        }

        return null;
    }

    /**
     * Тест вызова процессора получения списка ресурсов
     */
    async testGetResourcesList() {
        console.log('\n📋 Тест 3: Получение списка ресурсов');
        
        try {
            const result = await this.sendMcpCommand('tools/call', 'modx_call_processor', {
                namespace: 'core',
                action: 'resource/getlist',
                data: {
                    limit: 5,
                    start: 0
                }
            });

            if (result.content && result.content[0]) {
                const response = JSON.parse(result.content[0].text);
                
                if (response.success !== false) {
                    console.log('✅ Список ресурсов получен');
                    
                    if (response.results && Array.isArray(response.results)) {
                        console.log(`   Найдено ресурсов: ${response.results.length}`);
                        console.log('   Примеры ресурсов:');
                        response.results.forEach(resource => {
                            console.log(`     - ID: ${resource.id}, Заголовок: "${resource.pagetitle}"`);
                        });
                    } else if (response.data && Array.isArray(response.data)) {
                        console.log(`   Найдено ресурсов: ${response.data.length}`);
                        console.log('   Примеры ресурсов:');
                        response.data.forEach(resource => {
                            console.log(`     - ID: ${resource.id}, Заголовок: "${resource.pagetitle}"`);
                        });
                    } else {
                        console.log('   Ответ получен, но структура данных неожиданная');
                        console.log('   Ответ:', JSON.stringify(response, null, 2));
                    }
                    
                    this.addTestResult('get_resources', true, 'Список ресурсов получен успешно');
                } else {
                    console.log('❌ Ошибка получения ресурсов:', response.message || 'неизвестная ошибка');
                    this.addTestResult('get_resources', false, response.message || 'неизвестная ошибка');
                }
            } else {
                console.log('❌ Неверный формат ответа при получении ресурсов');
                this.addTestResult('get_resources', false, 'Неверный формат ответа');
            }

        } catch (error) {
            console.log('❌ Ошибка при получении ресурсов:', error.message);
            this.addTestResult('get_resources', false, error.message);
        }
    }

    /**
     * Тест информации о сессии
     */
    async testSessionInfo() {
        console.log('\n📋 Тест 4: Информация о сессии');
        
        try {
            const result = await this.sendMcpCommand('tools/call', 'modx_get_session_info', {});

            if (result.content && result.content[0]) {
                const response = JSON.parse(result.content[0].text);
                
                if (response.isAuthenticated) {
                    console.log('✅ Сессия активна');
                    console.log(`   Base URL: ${response.baseUrl}`);
                    console.log(`   Connector URL: ${response.connectorUrl}`);
                    console.log(`   Время входа: ${response.loginTime}`);
                    this.addTestResult('session_info', true, 'Информация о сессии получена');
                } else {
                    console.log('❌ Сессия неактивна');
                    this.addTestResult('session_info', false, 'Сессия неактивна');
                }
            } else {
                console.log('❌ Неверный формат ответа для информации о сессии');
                this.addTestResult('session_info', false, 'Неверный формат ответа');
            }

        } catch (error) {
            console.log('❌ Ошибка при получении информации о сессии:', error.message);
            this.addTestResult('session_info', false, error.message);
        }
    }

    /**
     * Добавить результат теста
     */
    addTestResult(testName, success, message) {
        this.testResults.push({
            test: testName,
            success: success,
            message: message,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Показать итоговые результаты
     */
    showResults() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ');
        console.log('='.repeat(60));

        let passed = 0;
        let failed = 0;

        this.testResults.forEach(result => {
            const status = result.success ? '✅ PASSED' : '❌ FAILED';
            console.log(`${status} ${result.test}: ${result.message}`);
            
            if (result.success) {
                passed++;
            } else {
                failed++;
            }
        });

        console.log('\n' + '-'.repeat(60));
        console.log(`Пройдено: ${passed}, Провалено: ${failed}, Всего: ${this.testResults.length}`);
        
        if (failed === 0) {
            console.log('🎉 Все тесты пройдены успешно!');
        } else {
            console.log('⚠️  Есть проваленные тесты. Проверьте конфигурацию.');
        }
        
        console.log('='.repeat(60));
    }

    /**
     * Запустить все тесты
     */
    async runAllTests() {
        try {
            console.log('🧪 MODX Proxy MCP Тестирование');
            console.log(`Base URL: ${this.baseUrl}`);
            console.log(`Username: ${this.username}`);
            console.log(`Connector Path: ${this.connectorPath}`);
            console.log(`Admin Path: ${this.adminPath}`);

            await this.startMcpServer();
            
            // Пауза для стабилизации сервера
            await new Promise(resolve => setTimeout(resolve, 2000));

            await this.testLogin();
            await this.testGetProcessors();
            await this.testGetResourcesList();
            await this.testSessionInfo();

        } catch (error) {
            console.error('❌ Критическая ошибка тестирования:', error.message);
            this.addTestResult('critical_error', false, error.message);
        } finally {
            this.stopMcpServer();
            this.showResults();
        }
    }
}

// Парсинг аргументов командной строки
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};

    for (let i = 0; i < args.length; i += 2) {
        const key = args[i];
        const value = args[i + 1];

        switch (key) {
            case '--base-url':
                options.baseUrl = value;
                break;
            case '--username':
                options.username = value;
                break;
            case '--password':
                options.password = value;
                break;
            case '--connector-path':
                options.connectorPath = value;
                break;
            case '--admin-path':
                options.adminPath = value;
                break;
            case '--help':
            case '-h':
                console.log(`
Использование: node test-modx-connection.js [options]

Параметры:
  --base-url URL        Base URL MODX (по умолчанию: http://localhost)
  --username USER       Имя пользователя (по умолчанию: admin)
  --password PASS       Пароль (по умолчанию: password)
  --connector-path PATH Путь к коннекторам (по умолчанию: /connectors/)
  --admin-path PATH     Путь к админке (по умолчанию: /manager/)
  --help, -h           Показать эту справку

Переменные окружения:
  MODX_BASE_URL, MODX_USERNAME, MODX_PASSWORD, 
  MODX_CONNECTOR_PATH, MODX_ADMIN_PATH

Примеры:
  node test-modx-connection.js
  node test-modx-connection.js --base-url http://mysite.local --username admin
`);
                process.exit(0);
                break;
        }
    }

    return options;
}

// Главная функция
async function main() {
    const options = parseArgs();
    const tester = new ModxMcpTester(options);
    
    // Обработка сигналов для корректного завершения
    process.on('SIGINT', () => {
        console.log('\n\n🛑 Получен сигнал SIGINT, завершение тестирования...');
        tester.stopMcpServer();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n\n🛑 Получен сигнал SIGTERM, завершение тестирования...');
        tester.stopMcpServer();
        process.exit(0);
    });

    await tester.runAllTests();
}

// Запуск если файл вызван напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('Критическая ошибка:', error);
        process.exit(1);
    });
}

export { ModxMcpTester };