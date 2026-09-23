const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../postman/RozFM_Admin_API.postman_collection.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Check if 18. Revenue Share Management already exists
const existingIdx = data.item.findIndex((it) => it.name.includes('Revenue Share'));
if (existingIdx !== -1) {
  data.item.splice(existingIdx, 1);
}

const revenueShareFolder = {
  name: '18. Revenue Share Management',
  item: [
    {
      name: 'Get Revenue Share List',
      request: {
        method: 'GET',
        header: [
          {
            key: 'Authorization',
            value: 'Bearer {{admin_token}}',
          },
        ],
        url: {
          raw: '{{base_url}}/admin/revenue-shares?page=1&limit=20&sort_by=this_month&order=DESC&status=all',
          host: ['{{base_url}}'],
          path: ['admin', 'revenue-shares'],
          query: [
            { key: 'page', value: '1', description: 'Page number' },
            { key: 'limit', value: '20', description: 'Records per page' },
            { key: 'search', value: '', description: 'Search by creator name, email, or phone', disabled: true },
            { key: 'status', value: 'all', description: 'all | active | inactive' },
            { key: 'sort_by', value: 'this_month', description: 'this_month | rev_share | name | total_earnings | created_at' },
            { key: 'order', value: 'DESC', description: 'DESC | ASC' },
            { key: 'month', value: '', description: 'Optional YYYY-MM (e.g. 2026-09)', disabled: true },
          ],
        },
        description: 'Fetch paginated revenue split list for admin panel menu showing creator avatars, custom/inherited rev share %, this month\'s earnings (INR), total earnings, and summary metrics.',
      },
      response: [
        {
          name: '200 OK — Revenue Share List',
          originalRequest: {
            method: 'GET',
            header: [
              {
                key: 'Authorization',
                value: 'Bearer {{admin_token}}',
              },
            ],
            url: {
              raw: '{{base_url}}/admin/revenue-shares?page=1&limit=20',
              host: ['{{base_url}}'],
              path: ['admin', 'revenue-shares'],
            },
          },
          status: 'OK',
          code: 200,
          _postman_previewlanguage: 'json',
          header: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
          ],
          body: JSON.stringify(
            {
              status: true,
              message: 'Revenue share list fetched successfully.',
              data: {
                creators: [
                  {
                    id: 1018,
                    user_id: 1018,
                    name: 'Sanya Bose',
                    email: 'sanya.bose@rozfm.com',
                    phone: '+919988776658',
                    username: 'sanya_bose',
                    avatar_path: null,
                    avatar_url: null,
                    initials: 'SB',
                    avatar_color: '#EF4444',
                    rev_share: 72,
                    rev_share_percentage: 72,
                    is_custom_rev_share: true,
                    formatted_rev_share: '72%',
                    this_month: 1290000,
                    this_month_earnings: 1290000,
                    formatted_this_month: '₹12,90,000',
                    total_earnings: 1290000,
                    formatted_total_earnings: '₹12,90,000',
                    is_verified: true,
                    is_blocked: false,
                    status: 'active',
                    created_at: '2026-09-23T09:42:48.000Z',
                    updated_at: '2026-09-23T09:42:48.000Z',
                  },
                  {
                    id: 1015,
                    user_id: 1015,
                    name: 'Meera Iyer',
                    email: 'meera.iyer@rozfm.com',
                    phone: '+919988776655',
                    username: 'meera_iyer',
                    avatar_path: null,
                    avatar_url: null,
                    initials: 'MI',
                    avatar_color: '#6366F1',
                    rev_share: 70,
                    rev_share_percentage: 70,
                    is_custom_rev_share: true,
                    formatted_rev_share: '70%',
                    this_month: 842000,
                    this_month_earnings: 842000,
                    formatted_this_month: '₹8,42,000',
                    total_earnings: 842000,
                    formatted_total_earnings: '₹8,42,000',
                    is_verified: true,
                    is_blocked: false,
                    status: 'active',
                    created_at: '2026-09-23T09:42:47.000Z',
                    updated_at: '2026-09-23T09:42:47.000Z',
                  },
                  {
                    id: 1016,
                    user_id: 1016,
                    name: 'Aman Kapoor',
                    email: 'aman.kapoor@rozfm.com',
                    phone: '+919988776656',
                    username: 'aman_kapoor',
                    avatar_path: null,
                    avatar_url: null,
                    initials: 'AK',
                    avatar_color: '#F59E0B',
                    rev_share: 65,
                    rev_share_percentage: 65,
                    is_custom_rev_share: true,
                    formatted_rev_share: '65%',
                    this_month: 310500,
                    this_month_earnings: 310500,
                    formatted_this_month: '₹3,10,500',
                    total_earnings: 310500,
                    formatted_total_earnings: '₹3,10,500',
                    is_verified: true,
                    is_blocked: false,
                    status: 'active',
                    created_at: '2026-09-23T09:42:47.000Z',
                    updated_at: '2026-09-23T09:42:47.000Z',
                  },
                  {
                    id: 1017,
                    user_id: 1017,
                    name: 'Rhea Verma',
                    email: 'rhea.verma@rozfm.com',
                    phone: '+919988776657',
                    username: 'rhea_verma',
                    avatar_path: null,
                    avatar_url: null,
                    initials: 'RV',
                    avatar_color: '#0EA5E9',
                    rev_share: 60,
                    rev_share_percentage: 60,
                    is_custom_rev_share: true,
                    formatted_rev_share: '60%',
                    this_month: 58200,
                    this_month_earnings: 58200,
                    formatted_this_month: '₹58,200',
                    total_earnings: 58200,
                    formatted_total_earnings: '₹58,200',
                    is_verified: true,
                    is_blocked: false,
                    status: 'active',
                    created_at: '2026-09-23T09:42:48.000Z',
                    updated_at: '2026-09-23T09:42:48.000Z',
                  },
                  {
                    id: 1019,
                    user_id: 1019,
                    name: 'Ishaan Gill',
                    email: 'ishaan.gill@rozfm.com',
                    phone: '+919988776659',
                    username: 'ishaan_gill',
                    avatar_path: null,
                    avatar_url: null,
                    initials: 'IG',
                    avatar_color: '#10B981',
                    rev_share: 55,
                    rev_share_percentage: 55,
                    is_custom_rev_share: true,
                    formatted_rev_share: '55%',
                    this_month: 14000,
                    this_month_earnings: 14000,
                    formatted_this_month: '₹14,000',
                    total_earnings: 14000,
                    formatted_total_earnings: '₹14,000',
                    is_verified: true,
                    is_blocked: false,
                    status: 'active',
                    created_at: '2026-09-23T09:42:48.000Z',
                    updated_at: '2026-09-23T09:42:48.000Z',
                  },
                ],
                summary: {
                  total: 5,
                  total_creators: 5,
                  active: 5,
                  active_creators: 5,
                  inactive: 0,
                  inactive_creators: 0,
                  default_rev_share: 70,
                  formatted_default_rev_share: '70%',
                  total_this_month_revenue: 2514700,
                  formatted_total_this_month: '₹25,14,700',
                },
                pagination: {
                  total: 5,
                  page: 1,
                  limit: 20,
                  total_pages: 1,
                },
              },
            },
            null,
            2
          ),
        },
      ],
    },
    {
      name: 'Get Single Creator Revenue Share',
      request: {
        method: 'GET',
        header: [
          {
            key: 'Authorization',
            value: 'Bearer {{admin_token}}',
          },
        ],
        url: {
          raw: '{{base_url}}/admin/revenue-share/1015',
          host: ['{{base_url}}'],
          path: ['admin', 'revenue-share', '1015'],
        },
        description: 'Fetch detailed revenue split breakdown for an individual creator, including 6-month historical earnings and recent transactions.',
      },
      response: [
        {
          name: '200 OK — Creator Revenue Share Details',
          originalRequest: {
            method: 'GET',
            header: [
              {
                key: 'Authorization',
                value: 'Bearer {{admin_token}}',
              },
            ],
            url: {
              raw: '{{base_url}}/admin/revenue-share/1015',
              host: ['{{base_url}}'],
              path: ['admin', 'revenue-share', '1015'],
            },
          },
          status: 'OK',
          code: 200,
          _postman_previewlanguage: 'json',
          header: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
          ],
          body: JSON.stringify(
            {
              status: true,
              message: 'Creator revenue share details fetched successfully.',
              data: {
                id: 1015,
                user_id: 1015,
                name: 'Meera Iyer',
                email: 'meera.iyer@rozfm.com',
                phone: '+919988776655',
                username: 'meera_iyer',
                initials: 'MI',
                avatar_color: '#6366F1',
                rev_share: 70,
                rev_share_percentage: 70,
                formatted_rev_share: '70%',
                platform_share_percentage: 30,
                formatted_platform_share: '30%',
                is_custom_rev_share: true,
                default_platform_rev_share: 70,
                this_month_earnings: 842000,
                formatted_this_month: '₹8,42,000',
                total_earnings: 842000,
                formatted_total_earnings: '₹8,42,000',
                stories_count: 5,
                status: 'active',
                is_verified: true,
                monthly_history: [
                  { month: '2026-09', amount: 842000, formatted_amount: '₹8,42,000' },
                ],
              },
            },
            null,
            2
          ),
        },
      ],
    },
    {
      name: 'Update Creator Revenue Share',
      request: {
        method: 'PUT',
        header: [
          {
            key: 'Authorization',
            value: 'Bearer {{admin_token}}',
          },
          {
            key: 'Content-Type',
            value: 'application/json',
          },
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              rev_share_percentage: 75,
            },
            null,
            2
          ),
        },
        url: {
          raw: '{{base_url}}/admin/revenue-share/1015',
          host: ['{{base_url}}'],
          path: ['admin', 'revenue-share', '1015'],
        },
        description: 'Update creator individual revenue share percentage (0-100). Accepts `rev_share_percentage` or `rev_share`.',
      },
      response: [
        {
          name: '200 OK — Revenue Share Updated',
          originalRequest: {
            method: 'PUT',
            header: [
              {
                key: 'Authorization',
                value: 'Bearer {{admin_token}}',
              },
              {
                key: 'Content-Type',
                value: 'application/json',
              },
            ],
            body: {
              mode: 'raw',
              raw: '{\n  "rev_share_percentage": 75\n}',
            },
            url: {
              raw: '{{base_url}}/admin/revenue-share/1015',
              host: ['{{base_url}}'],
              path: ['admin', 'revenue-share', '1015'],
            },
          },
          status: 'OK',
          code: 200,
          _postman_previewlanguage: 'json',
          header: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
          ],
          body: JSON.stringify(
            {
              status: true,
              message: 'Creator revenue share updated successfully.',
              data: {
                id: 1015,
                name: 'Meera Iyer',
                rev_share: 75,
                rev_share_percentage: 75,
                formatted_rev_share: '75%',
                platform_share: 25,
                formatted_platform_share: '25%',
              },
            },
            null,
            2
          ),
        },
      ],
    },
    {
      name: 'Reset Creator Revenue Share to Default',
      request: {
        method: 'DELETE',
        header: [
          {
            key: 'Authorization',
            value: 'Bearer {{admin_token}}',
          },
        ],
        url: {
          raw: '{{base_url}}/admin/revenue-share/1015/reset',
          host: ['{{base_url}}'],
          path: ['admin', 'revenue-share', '1015', 'reset'],
        },
        description: 'Reset creator individual revenue share back to NULL so that creator uses platform default.',
      },
      response: [
        {
          name: '200 OK — Reset to Default',
          originalRequest: {
            method: 'DELETE',
            header: [
              {
                key: 'Authorization',
                value: 'Bearer {{admin_token}}',
              },
            ],
            url: {
              raw: '{{base_url}}/admin/revenue-share/1015/reset',
              host: ['{{base_url}}'],
              path: ['admin', 'revenue-share', '1015', 'reset'],
            },
          },
          status: 'OK',
          code: 200,
          _postman_previewlanguage: 'json',
          header: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
          ],
          body: JSON.stringify(
            {
              status: true,
              message: 'Creator revenue share reset to platform default successfully.',
              data: {
                id: 1015,
                name: 'Meera Iyer',
                rev_share: 70,
                rev_share_percentage: 70,
                is_custom_rev_share: false,
                formatted_rev_share: '70%',
              },
            },
            null,
            2
          ),
        },
      ],
    },
    {
      name: 'Get Platform Default Revenue Share Setting',
      request: {
        method: 'GET',
        header: [
          {
            key: 'Authorization',
            value: 'Bearer {{admin_token}}',
          },
        ],
        url: {
          raw: '{{base_url}}/admin/revenue-share/settings',
          host: ['{{base_url}}'],
          path: ['admin', 'revenue-share', 'settings'],
        },
        description: 'Get current system-wide default revenue share percentage split (e.g. 70% creator / 30% platform).',
      },
      response: [
        {
          name: '200 OK — Global Setting',
          originalRequest: {
            method: 'GET',
            header: [
              {
                key: 'Authorization',
                value: 'Bearer {{admin_token}}',
              },
            ],
            url: {
              raw: '{{base_url}}/admin/revenue-share/settings',
              host: ['{{base_url}}'],
              path: ['admin', 'revenue-share', 'settings'],
            },
          },
          status: 'OK',
          code: 200,
          _postman_previewlanguage: 'json',
          header: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
          ],
          body: JSON.stringify(
            {
              status: true,
              message: 'Platform default revenue share setting fetched successfully.',
              data: {
                key: 'writer_revenue_share_percentage',
                default_rev_share: 70,
                formatted_default_rev_share: '70%',
                creator_split: 70,
                platform_split: 30,
              },
            },
            null,
            2
          ),
        },
      ],
    },
    {
      name: 'Update Platform Default Revenue Share Setting',
      request: {
        method: 'POST',
        header: [
          {
            key: 'Authorization',
            value: 'Bearer {{admin_token}}',
          },
          {
            key: 'Content-Type',
            value: 'application/json',
          },
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              rev_share_percentage: 70,
            },
            null,
            2
          ),
        },
        url: {
          raw: '{{base_url}}/admin/revenue-share/settings',
          host: ['{{base_url}}'],
          path: ['admin', 'revenue-share', 'settings'],
        },
        description: 'Update system-wide default revenue share percentage split applied to all creators.',
      },
      response: [
        {
          name: '200 OK — Global Setting Updated',
          originalRequest: {
            method: 'POST',
            header: [
              {
                key: 'Authorization',
                value: 'Bearer {{admin_token}}',
              },
              {
                key: 'Content-Type',
                value: 'application/json',
              },
            ],
            body: {
              mode: 'raw',
              raw: '{\n  "rev_share_percentage": 70\n}',
            },
            url: {
              raw: '{{base_url}}/admin/revenue-share/settings',
              host: ['{{base_url}}'],
              path: ['admin', 'revenue-share', 'settings'],
            },
          },
          status: 'OK',
          code: 200,
          _postman_previewlanguage: 'json',
          header: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
          ],
          body: JSON.stringify(
            {
              status: true,
              message: 'Platform default revenue share setting updated successfully.',
              data: {
                key: 'writer_revenue_share_percentage',
                default_rev_share: 70,
                formatted_default_rev_share: '70%',
                creator_split: 70,
                platform_split: 30,
              },
            },
            null,
            2
          ),
        },
      ],
    },
    {
      name: 'Export Revenue Share List (CSV)',
      request: {
        method: 'GET',
        header: [
          {
            key: 'Authorization',
            value: 'Bearer {{admin_token}}',
          },
        ],
        url: {
          raw: '{{base_url}}/admin/revenue-share/export?format=csv',
          host: ['{{base_url}}'],
          path: ['admin', 'revenue-share', 'export'],
          query: [
            { key: 'format', value: 'csv', description: 'csv | json' },
            { key: 'search', value: '', description: 'Optional search filter', disabled: true },
            { key: 'status', value: 'all', description: 'all | active | inactive', disabled: true },
          ],
        },
        description: 'Export creator revenue share report as a downloadable CSV or JSON file.',
      },
      response: [
        {
          name: '200 OK — CSV File Download',
          originalRequest: {
            method: 'GET',
            header: [
              {
                key: 'Authorization',
                value: 'Bearer {{admin_token}}',
              },
            ],
            url: {
              raw: '{{base_url}}/admin/revenue-share/export?format=csv',
              host: ['{{base_url}}'],
              path: ['admin', 'revenue-share', 'export'],
            },
          },
          status: 'OK',
          code: 200,
          _postman_previewlanguage: 'text',
          header: [
            {
              key: 'Content-Type',
              value: 'text/csv',
            },
            {
              key: 'Content-Disposition',
              value: 'attachment; filename="rozfm_revenue_shares.csv"',
            },
          ],
          body: 'User ID,Name,Email,Phone,Rev Share,This Month (INR),Total Revenue (INR),Status,Joined Date\n1018,"Sanya Bose","sanya.bose@rozfm.com","+919988776658","72%","₹12,90,000","₹12,90,000","active","2026-09-23"\n1015,"Meera Iyer","meera.iyer@rozfm.com","+919988776655","70%","₹8,42,000","₹8,42,000","active","2026-09-23"\n1016,"Aman Kapoor","aman.kapoor@rozfm.com","+919988776656","65%","₹3,10,500","₹3,10,500","active","2026-09-23"\n1017,"Rhea Verma","rhea.verma@rozfm.com","+919988776657","60%","₹58,200","₹58,200","active","2026-09-23"\n1019,"Ishaan Gill","ishaan.gill@rozfm.com","+919988776659","55%","₹14,000","₹14,000","active","2026-09-23"',
        },
      ],
    },
  ],
};

data.item.push(revenueShareFolder);

fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
console.log('✅ Added 18. Revenue Share Management to RozFM_Admin_API.postman_collection.json successfully!');
