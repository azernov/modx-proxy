#!/usr/bin/env node

/**
 * Прямой тест MODX подключения без MCP протокола
 */

import { ModxProxyService } from './dist/modx-proxy.js';

async function testDirectConnection() {
    console.log('🔍 Прямой тест подключения к MODX');
    console.log('Domain: http://claude-modx-mcp.my');
    console.log('Username: admin');
    console.log('Password: adminadmin');

    // Установим переменные окружения
    process.env.MODX_BASE_URL = 'http://claude-modx-mcp.my';
    process.env.MODX_CONNECTOR_PATH = '/connectors/';
    process.env.MODX_ADMIN_PATH = '/manager/';

    const modxProxy = new ModxProxyService();

    try {
        console.log('\n=== Тест 1: Авторизация ===');
        
        const loginResult = await modxProxy.login('admin', 'adminadmin', 'http://claude-modx-mcp.my');
        
        if (loginResult.success) {
            console.log('✅ Авторизация успешна');
            console.log('Пользователь:', loginResult.user?.username || 'неизвестен');
            console.log('Session info:', loginResult.sessionInfo);

            console.log('\n=== Тест 2: Получение списка процессоров ===');
            
            try {
                const processors = await modxProxy.getProcessors();
                console.log('✅ Список процессоров получен');
                console.log('Всего процессоров:', processors.total);
                console.log('Сгенерирован:', processors.generated_at);
                
                console.log('\nПримеры процессоров:');
                processors.processors.slice(0, 5).forEach(proc => {
                    console.log(`  - ${proc.namespace}/${proc.path}: ${proc.description}`);
                });

                console.log('\n=== Тест 3: Вызов процессора resource/getlist ===');
                
                try {
                    const resourcesResult = await modxProxy.callProcessor('core', 'resource/getlist', {
                        limit: 3,
                        start: 0
                    });
                    
                    if (resourcesResult.success !== false) {
                        console.log('✅ Процессор resource/getlist выполнен');
                        
                        const resources = resourcesResult.results || resourcesResult.data || [];
                        if (Array.isArray(resources)) {
                            console.log(`Найдено ресурсов: ${resources.length}`);
                            resources.forEach(res => {
                                console.log(`  - ID: ${res.id}, "${res.pagetitle}"`);
                            });
                        } else {
                            console.log('Структура ответа:', Object.keys(resourcesResult));
                        }
                    } else {
                        console.log('❌ Ошибка процессора:', resourcesResult.message);
                    }
                } catch (error) {
                    console.error('❌ Ошибка вызова процессора:', error.message);
                }

                console.log('\n=== Тест 4: Информация о сессии ===');
                
                const sessionInfo = modxProxy.getSessionInfo();
                console.log('✅ Информация о сессии получена');
                console.log('Авторизован:', sessionInfo.isAuthenticated);
                console.log('Base URL:', sessionInfo.baseUrl);
                console.log('Connector URL:', sessionInfo.connectorUrl);

            } catch (error) {
                console.error('❌ Ошибка получения процессоров:', error.message);
            }

        } else {
            console.log('❌ Ошибка авторизации:', loginResult.message);
        }

    } catch (error) {
        console.error('❌ Критическая ошибка:', error.message);
        console.error('Stack:', error.stack);
    }

    console.log('\n🏁 Тест завершен');
}

testDirectConnection().catch(error => {
    console.error('Неожиданная ошибка:', error);
    process.exit(1);
});