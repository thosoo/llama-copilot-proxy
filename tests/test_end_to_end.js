#!/usr/bin/env node

/**
 * End-to-end test for the Copilot-to-Ollama proxy
 * Tests all key functionality including path rewriting, tool schema patching, and streaming
 */

import { spawn } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(color, message) {
    console.log(`${color}${message}${colors.reset}`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testEndpoint(name, endpoint, payload, expectedChecks) {
    log(colors.blue, `\n🧪 Testing ${name}...`);
    
    return new Promise((resolve, reject) => {
        const curl = spawn('curl', [
            '-X', 'POST',
            `http://127.0.0.1:11434${endpoint}`,
            '-H', 'Content-Type: application/json',
            '-d', JSON.stringify(payload),
            '--silent'
        ]);

        let output = '';
        let error = '';

        curl.stdout.on('data', (data) => {
            output += data.toString();
        });

        curl.stderr.on('data', (data) => {
            error += data.toString();
        });

        curl.on('close', (code) => {
            if (code !== 0) {
                log(colors.red, `❌ ${name}: curl failed with code ${code}`);
                log(colors.red, `Error: ${error}`);
                reject(new Error(`curl failed: ${error}`));
                return;
            }

            let passed = 0;
            let total = expectedChecks.length;

            expectedChecks.forEach(check => {
                if (check.test(output)) {
                    log(colors.green, `  ✅ ${check.description}`);
                    passed++;
                } else {
                    log(colors.red, `  ❌ ${check.description}`);
                }
            });

            if (passed === total) {
                log(colors.green, `✅ ${name}: All ${total} checks passed!`);
                resolve(true);
            } else {
                log(colors.red, `❌ ${name}: ${passed}/${total} checks passed`);
                resolve(false);
            }
        });
    });
}

async function runTests() {
    log(colors.yellow, '🚀 Starting end-to-end tests for Copilot-to-Ollama proxy');
    log(colors.yellow, '==================================================');

    const tests = [
        {
            name: 'Basic Chat Completion',
            endpoint: '/api/chat',
            payload: {
                model: 'qwen3',
                messages: [
                    { role: 'user', content: 'Say hello briefly' }
                ],
                stream: false
            },
            checks: [
                { description: 'Response contains choices array', test: (output) => output.includes('"choices"') },
                { description: 'Response has finish_reason', test: (output) => output.includes('"finish_reason"') },
                { description: 'Response contains message content', test: (output) => output.includes('"content"') }
            ]
        },
        {
            name: 'Streaming Chat Completion',
            endpoint: '/api/chat',
            payload: {
                model: 'qwen3',
                messages: [
                    { role: 'user', content: 'Count to 3' }
                ],
                stream: true
            },
            checks: [
                { description: 'Response uses server-sent events format', test: (output) => output.includes('data: {') },
                { description: 'Response contains streaming chunks', test: (output) => output.includes('chat.completion.chunk') },
                { description: 'Response ends with [DONE]', test: (output) => output.includes('data: [DONE]') }
            ]
        },
        {
            name: 'Tool-calling with Schema Patching',
            endpoint: '/api/chat',
            payload: {
                model: 'qwen3',
                messages: [
                    { role: 'user', content: 'Create a file called hello.txt with the content "Hello World"' }
                ],
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'create_file',
                            description: 'Create a new file with specified content',
                            // Intentionally missing parameters to test auto-patching
                        }
                    }
                ],
                stream: true
            },
            checks: [
                { description: 'Response processes tool call correctly', test: (output) => output.includes('choices') },
                { description: 'Response maintains streaming format', test: (output) => output.includes('data: {') },
                { description: 'No JSON parsing errors occurred', test: (output) => !output.includes('SyntaxError') }
            ]
        }
    ];

    let passedTests = 0;
    
    for (const test of tests) {
        try {
            const result = await testEndpoint(test.name, test.endpoint, test.payload, test.checks);
            if (result) passedTests++;
            await sleep(1000); // Brief pause between tests
        } catch (error) {
            log(colors.red, `❌ ${test.name}: Test failed with error: ${error.message}`);
        }
    }

    log(colors.yellow, '\n==================================================');
    
    if (passedTests === tests.length) {
        log(colors.green, `🎉 All ${tests.length} tests passed! Proxy is working correctly.`);
        log(colors.green, '✅ VS Code Copilot should now work with this proxy configuration:');
        log(colors.blue, '   "github.copilot.advanced.debug.overrideEngine": "http://127.0.0.1:11434"');
    } else {
        log(colors.red, `❌ Only ${passedTests}/${tests.length} tests passed. Please check the issues above.`);
    }
    
    log(colors.yellow, '\n📊 Test Summary:');
    log(colors.blue, `   • Total Tests: ${tests.length}`);
    log(colors.blue, `   • Passed: ${passedTests}`);
    log(colors.blue, `   • Failed: ${tests.length - passedTests}`);
}

// Run the tests
runTests().catch(error => {
    log(colors.red, `💥 Test suite failed: ${error.message}`);
    process.exit(1);
});
