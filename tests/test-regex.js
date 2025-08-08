// Test the regex pattern to ensure it matches both endpoints
const pattern = /^(\/(v1\/)?)?chat\/completions$/;

const testUrls = [
  '/chat/completions',
  '/v1/chat/completions',
  '/api/chat/completions',  // should not match
  '/chat/completions/extra', // should not match
  '/v1/chat/completions/extra' // should not match
];

console.log('Testing regex pattern: /^(/(v1/)?)?chat/completions$/');
console.log('='.repeat(50));

testUrls.forEach(url => {
  const matches = pattern.test(url);
  console.log(`${url.padRight ? url.padRight(25) : (url + ' '.repeat(25)).substring(0, 25)} -> ${matches ? '✓ MATCHES' : '✗ NO MATCH'}`);
});
