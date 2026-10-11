const jwt = require('jsonwebtoken');
const http = require('http');
const app = require('../src/app');

async function runTests() {
  console.log('🧪 Running Backup & Restore API Test Suite...');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/admin`;

  const token = jwt.sign(
    { id: 2, role: 'admin' },
    process.env.JWT_SECRET || 'rozfm_super_secret_jwt_key_2026',
    { expiresIn: '1h' }
  );

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    // 1. Test GET /backups
    console.log('\n--- Test 1: GET /api/v1/admin/backups ---');
    const resList = await fetch(`${baseUrl}/backups`, { headers });
    const jsonList = await resList.json();
    console.log('Status:', resList.status);
    console.log('Total backups:', jsonList.data?.backups?.length);
    console.log('Total size:', jsonList.data?.stats?.total_size);
    jsonList.data?.backups?.forEach(b => {
      console.log(` - ID: ${b.backup_id} | Size: ${b.size} | Created: ${b.created} | Status: ${b.status}`);
    });
    if (resList.status !== 200 || !jsonList.data?.backups?.length) {
      throw new Error('GET backups failed');
    }

    // 2. Test GET /backups/1
    console.log('\n--- Test 2: GET /api/v1/admin/backups/1 ---');
    const resShow = await fetch(`${baseUrl}/backups/1`, { headers });
    const jsonShow = await resShow.json();
    console.log('Status:', resShow.status);
    console.log('Backup ID:', jsonShow.data?.backup?.backup_id);
    console.log('Backup Size:', jsonShow.data?.backup?.size);
    if (resShow.status !== 200 || jsonShow.data?.backup?.backup_id !== 'BKP-9201') {
      throw new Error('GET single backup failed');
    }

    // 3. Test POST /backups (Create Backup Now)
    console.log('\n--- Test 3: POST /api/v1/admin/backups (Create Backup Now) ---');
    const resCreate = await fetch(`${baseUrl}/backups`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ notes: 'Automated test snapshot' })
    });
    const jsonCreate = await resCreate.json();
    console.log('Status:', resCreate.status);
    console.log('Created Backup Code:', jsonCreate.data?.backup?.backup_id);
    console.log('Created Size:', jsonCreate.data?.backup?.size);
    console.log('Created Status:', jsonCreate.data?.backup?.status);
    if (resCreate.status !== 201) throw new Error('POST create backup failed');
    const createdId = jsonCreate.data.backup.id;

    // 4. Test POST /backups/:id/restore
    console.log('\n--- Test 4: POST /api/v1/admin/backups/:id/restore ---');
    const resRestore = await fetch(`${baseUrl}/backups/${createdId}/restore`, {
      method: 'POST',
      headers
    });
    const jsonRestore = await resRestore.json();
    console.log('Status:', resRestore.status);
    console.log('Message:', jsonRestore.message);
    if (resRestore.status !== 200) throw new Error('POST restore backup failed');

    // 5. Test GET /backups/:id/download
    console.log('\n--- Test 5: GET /api/v1/admin/backups/:id/download ---');
    const resDownload = await fetch(`${baseUrl}/backups/${createdId}/download`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Status:', resDownload.status);
    const content = await resDownload.text();
    console.log('Downloaded length:', content.length, 'bytes');
    if (resDownload.status !== 200 || !content.includes('Roz FM Database Backup')) {
      throw new Error('GET download backup failed');
    }

    // 6. Test DELETE /backups/:id
    console.log('\n--- Test 6: DELETE /api/v1/admin/backups/:id ---');
    const resDelete = await fetch(`${baseUrl}/backups/${createdId}`, {
      method: 'DELETE',
      headers
    });
    const jsonDelete = await resDelete.json();
    console.log('Status:', resDelete.status);
    console.log('Message:', jsonDelete.message);
    if (resDelete.status !== 200) throw new Error('DELETE backup failed');

    console.log('\n🎉 ALL BACKUP & RESTORE API TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ BACKUP TEST RUN FAILED:', err);
  process.exit(1);
});
