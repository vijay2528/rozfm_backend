const assert = require('assert');
const RazorpayBankService = require('../src/services/razorpayBankService');

async function runTests() {
  console.log('--- Starting Razorpay Bank Verification Tests ---');

  // Test 1: Valid IFSC code lookup
  console.log('Test 1: Testing valid IFSC code (HDFC0000053)...');
  const validIfsc = await RazorpayBankService.verifyIfsc('HDFC0000053');
  console.log('Result:', { valid: validIfsc.valid, bank: validIfsc.bank, branch: validIfsc.branch });
  assert.strictEqual(validIfsc.valid, true, 'Valid IFSC should return true');
  assert.ok(validIfsc.bank.toLowerCase().includes('hdfc'), 'Bank name should contain HDFC');

  // Test 2: Invalid format IFSC code
  console.log('Test 2: Testing invalid format IFSC code (123XYZ)...');
  const invalidFormat = await RazorpayBankService.verifyIfsc('123XYZ');
  console.log('Result:', invalidFormat);
  assert.strictEqual(invalidFormat.valid, false, 'Invalid format IFSC should fail');

  // Test 3: Non-existent IFSC code
  console.log('Test 3: Testing non-existent IFSC code (SBIN0000000)...');
  const notFoundIfsc = await RazorpayBankService.verifyIfsc('SBIN0000000');
  console.log('Result:', notFoundIfsc);
  assert.strictEqual(notFoundIfsc.valid, false, 'Non-existent IFSC should fail');

  // Test 4: Check credentials reader
  console.log('Test 4: Reading Razorpay credentials from settings...');
  const creds = await RazorpayBankService.getCredentials();
  console.log('Credentials status:', {
    hasKeyId: Boolean(creds.keyId),
    hasKeySecret: Boolean(creds.keySecret),
    isConfigured: creds.isConfigured,
  });

  console.log('--- All preliminary tests passed successfully! ---');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
