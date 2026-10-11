const jwt = require('jsonwebtoken');
const http = require('http');
const app = require('../src/app');

async function runTests() {
  console.log('🧪 Running Roles API Test Suite...');

  // Start app on random port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/admin`;

  // Generate an admin token for testing
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
    // 1. Test GET /roles/permissions
    console.log('\n--- Test 1: GET /api/v1/admin/roles/permissions ---');
    const resPerms = await fetch(`${baseUrl}/roles/permissions`, { headers });
    const jsonPerms = await resPerms.json();
    console.log('Status:', resPerms.status);
    console.log('Success:', jsonPerms.status);
    console.log('Total catalog categories:', jsonPerms.data?.catalog?.length);
    console.log('Total permissions available:', jsonPerms.data?.total_permissions);
    if (resPerms.status !== 200) throw new Error('GET permissions failed');

    // 2. Test GET /roles (List roles)
    console.log('\n--- Test 2: GET /api/v1/admin/roles ---');
    const resList = await fetch(`${baseUrl}/roles`, { headers });
    const jsonList = await resList.json();
    console.log('Status:', resList.status);
    console.log('Total roles returned:', jsonList.data?.roles?.length);
    console.log('Roles summary:');
    jsonList.data?.roles?.forEach(r => {
      console.log(` - ID: ${r.id} | Role: ${r.display_name} | Admins: ${r.admins} | Key Perms: ${r.key_permissions}`);
    });
    if (resList.status !== 200) throw new Error('GET roles list failed');

    // 3. Test GET /roles/1 (Get Super Admin details)
    console.log('\n--- Test 3: GET /api/v1/admin/roles/1 ---');
    const resShow = await fetch(`${baseUrl}/roles/1`, { headers });
    const jsonShow = await resShow.json();
    console.log('Status:', resShow.status);
    console.log('Role Name:', jsonShow.data?.role?.display_name);
    console.log('Permissions:', jsonShow.data?.role?.permissions);
    console.log('Assigned Users:', jsonShow.data?.role?.assigned_users?.length);
    if (resShow.status !== 200) throw new Error('GET role show failed');

    // 4. Test POST /roles (Create a new role)
    console.log('\n--- Test 4: POST /api/v1/admin/roles ---');
    const uniqueSuffix = Date.now();
    const newRolePayload = {
      display_name: `Auditor Test ${uniqueSuffix}`,
      description: 'Internal audit role with read-only access to reports and finances.',
      permissions: ['reports.export', 'payments.view'],
      key_permissions: 'Audit, Financial Reports (read-only)',
      status: 1
    };
    const resCreate = await fetch(`${baseUrl}/roles`, {
      method: 'POST',
      headers,
      body: JSON.stringify(newRolePayload)
    });
    const jsonCreate = await resCreate.json();
    console.log('Status:', resCreate.status);
    console.log('Created Role ID:', jsonCreate.data?.role?.id);
    console.log('Created Role Slug:', jsonCreate.data?.role?.name);
    console.log('Created Role Key Perms:', jsonCreate.data?.role?.key_permissions);
    if (resCreate.status !== 201) throw new Error('POST create role failed');
    const createdRoleId = jsonCreate.data.role.id;

    // 5. Test PUT /roles/:id (Edit role)
    console.log('\n--- Test 5: PUT /api/v1/admin/roles/:id ---');
    const updatePayload = {
      display_name: `Senior Auditor ${uniqueSuffix}`,
      description: 'Updated auditor role description.',
      permissions: ['reports.export', 'payments.view', 'creators.analytics'],
      status: 1
    };
    const resUpdate = await fetch(`${baseUrl}/roles/${createdRoleId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updatePayload)
    });
    const jsonUpdate = await resUpdate.json();
    console.log('Status:', resUpdate.status);
    console.log('Updated Display Name:', jsonUpdate.data?.role?.display_name);
    console.log('Updated Key Perms:', jsonUpdate.data?.role?.key_permissions);
    if (resUpdate.status !== 200) throw new Error('PUT update role failed');

    // 6. Test Safeguard: Reject DELETE on System Role
    console.log('\n--- Test 6: Safeguard: Reject DELETE on System Role ---');
    const resDelSys = await fetch(`${baseUrl}/roles/1`, {
      method: 'DELETE',
      headers
    });
    const jsonDelSys = await resDelSys.json();
    console.log('Status (Expected 403):', resDelSys.status);
    console.log('Message:', jsonDelSys.message);
    if (resDelSys.status !== 403) throw new Error('Safeguard check failed for system role deletion');

    // 7. Test DELETE /roles/:id (Delete the created test role)
    console.log('\n--- Test 7: DELETE /api/v1/admin/roles/:id ---');
    const resDelete = await fetch(`${baseUrl}/roles/${createdRoleId}`, {
      method: 'DELETE',
      headers
    });
    const jsonDelete = await resDelete.json();
    console.log('Status:', resDelete.status);
    console.log('Message:', jsonDelete.message);
    if (resDelete.status !== 200) throw new Error('DELETE role failed');

    console.log('\n🎉 ALL ROLES API TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    server.close();
  }

  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
