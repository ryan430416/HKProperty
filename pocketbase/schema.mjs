export const PB = {
  users: 'hkp_users',
  assets: 'hkp_assets',
  loans: 'hkp_loan_records',
  usage: 'hkp_usage_records',
  audits: 'hkp_inventory_audits',
  locations: 'hkp_location_history',
  logs: 'hkp_operation_logs',
  settings: 'hkp_system_settings'
};

export const ROLES = ['borrower', 'staff', 'admin'];
export const AVAILABILITY = ['available', 'pending', 'checked_out', 'overdue', 'maintenance', 'lost'];
export const LOAN_STATUSES = [
  'pending', 'approved', 'checked_out', 'overdue',
  'return_pending', 'returned', 'rejected', 'cancelled'
];

export const HKP_AUTH = `@request.auth.id != "" && @request.auth.collectionName = "${PB.users}"`;
export const STAFF_RULE = `${HKP_AUTH} && (@request.auth.role = "staff" || @request.auth.role = "admin")`;
export const AUTH_RULE = HKP_AUTH;
export const ADMIN_RULE = `${HKP_AUTH} && @request.auth.role = "admin"`;

export const USER_EXTRA_FIELDS = [
  { name: 'display_name', type: 'text' },
  { name: 'school_number', type: 'text' },
  { name: 'department', type: 'text' },
  {
    name: 'role',
    type: 'select',
    required: true,
    maxSelect: 1,
    values: ROLES
  },
  { name: 'is_active', type: 'bool' }
];

export const COLLECTIONS = [
  {
    name: PB.users,
    type: 'auth',
    listRule: `${ADMIN_RULE} || @request.auth.id = id`,
    viewRule: `${ADMIN_RULE} || @request.auth.id = id`,
    createRule: '',
    updateRule: `@request.auth.id = id || ${ADMIN_RULE}`,
    deleteRule: ADMIN_RULE,
    fields: USER_EXTRA_FIELDS
  },
  {
    name: PB.assets,
    type: 'base',
    listRule: AUTH_RULE,
    viewRule: AUTH_RULE,
    createRule: STAFF_RULE,
    updateRule: STAFF_RULE,
    deleteRule: ADMIN_RULE,
    indexes: [
      `CREATE UNIQUE INDEX \`idx_${PB.assets}_property_id\` ON \`${PB.assets}\` (\`property_id\`)`
    ],
    fields: [
      { name: 'property_id', type: 'text', required: true },
      { name: 'name', type: 'text', required: true },
      { name: 'purchase_date', type: 'date' },
      { name: 'service_life', type: 'number' },
      { name: 'specification', type: 'text' },
      { name: 'unit', type: 'text' },
      { name: 'price', type: 'number' },
      { name: 'department', type: 'text' },
      { name: 'location', type: 'text' },
      { name: 'custodian', type: 'text' },
      { name: 'supplier', type: 'text' },
      { name: 'asset_status', type: 'text' },
      { name: 'availability_status', type: 'select', required: true, maxSelect: 1, values: AVAILABILITY },
      { name: 'usage_count', type: 'number', min: 0 },
      { name: 'note', type: 'text' },
      { name: 'brand', type: 'text' },
      { name: 'model', type: 'text' },
      { name: 'is_borrowable', type: 'bool' },
      { name: 'is_active', type: 'bool' },
      { name: 'audit_status', type: 'text' },
      { name: 'last_audit_at', type: 'date' },
      { name: 'return_alert', type: 'text' },
      {
        name: 'photo',
        type: 'file',
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        protected: false
      }
    ]
  },
  {
    name: PB.loans,
    type: 'base',
    listRule: `${STAFF_RULE} || borrower = @request.auth.id`,
    viewRule: `${STAFF_RULE} || borrower = @request.auth.id`,
    createRule: AUTH_RULE,
    updateRule: `${STAFF_RULE} || borrower = @request.auth.id`,
    deleteRule: ADMIN_RULE,
    indexes: [
      `CREATE UNIQUE INDEX \`idx_${PB.loans}_number\` ON \`${PB.loans}\` (\`loan_number\`)`
    ],
    fields: [
      { name: 'loan_number', type: 'text', required: true },
      { name: 'asset', type: 'relation', required: true, collectionName: PB.assets, maxSelect: 1, cascadeDelete: false },
      { name: 'property_id', type: 'text', required: true },
      { name: 'property_name', type: 'text', required: true },
      { name: 'borrower', type: 'relation', required: true, collectionName: PB.users, maxSelect: 1, cascadeDelete: false },
      { name: 'borrower_name', type: 'text', required: true },
      { name: 'borrower_number', type: 'text', required: true },
      { name: 'borrower_department', type: 'text', required: true },
      { name: 'purpose', type: 'text', required: true },
      { name: 'contact', type: 'text' },
      { name: 'requested_at', type: 'date' },
      { name: 'approved_at', type: 'date' },
      { name: 'approved_by', type: 'relation', collectionName: PB.users, maxSelect: 1, cascadeDelete: false },
      { name: 'checkout_at', type: 'date' },
      { name: 'expected_return_at', type: 'date', required: true },
      { name: 'returned_at', type: 'date' },
      { name: 'checkout_condition', type: 'text' },
      { name: 'return_condition', type: 'text' },
      { name: 'return_result', type: 'text' },
      { name: 'return_location', type: 'text' },
      { name: 'checkout_method', type: 'text' },
      { name: 'checkout_operator', type: 'text' },
      { name: 'return_operator', type: 'text' },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: LOAN_STATUSES },
      { name: 'rejection_reason', type: 'text' },
      { name: 'note', type: 'text' }
    ]
  },
  {
    name: PB.usage,
    type: 'base',
    listRule: AUTH_RULE,
    viewRule: AUTH_RULE,
    createRule: STAFF_RULE,
    updateRule: STAFF_RULE,
    deleteRule: ADMIN_RULE,
    fields: [
      { name: 'asset', type: 'relation', required: true, collectionName: PB.assets, maxSelect: 1, cascadeDelete: false },
      { name: 'loan', type: 'relation', collectionName: PB.loans, maxSelect: 1, cascadeDelete: false },
      { name: 'user_name', type: 'text', required: true },
      { name: 'department', type: 'text', required: true },
      { name: 'used_at', type: 'date', required: true },
      { name: 'purpose', type: 'text', required: true },
      { name: 'note', type: 'text' },
      { name: 'created_by', type: 'relation', collectionName: PB.users, maxSelect: 1, cascadeDelete: false }
    ]
  },
  {
    name: PB.audits,
    type: 'base',
    listRule: STAFF_RULE,
    viewRule: STAFF_RULE,
    createRule: STAFF_RULE,
    updateRule: STAFF_RULE,
    deleteRule: ADMIN_RULE,
    fields: [
      { name: 'asset', type: 'relation', required: true, collectionName: PB.assets, maxSelect: 1, cascadeDelete: false },
      { name: 'registered_location', type: 'text' },
      { name: 'actual_location', type: 'text', required: true },
      { name: 'result', type: 'text', required: true },
      { name: 'auditor', type: 'text', required: true },
      { name: 'audited_at', type: 'date', required: true },
      { name: 'note', type: 'text' },
      { name: 'created_by', type: 'relation', collectionName: PB.users, maxSelect: 1, cascadeDelete: false }
    ]
  },
  {
    name: PB.locations,
    type: 'base',
    listRule: STAFF_RULE,
    viewRule: STAFF_RULE,
    createRule: STAFF_RULE,
    updateRule: STAFF_RULE,
    deleteRule: ADMIN_RULE,
    fields: [
      { name: 'asset', type: 'relation', required: true, collectionName: PB.assets, maxSelect: 1, cascadeDelete: false },
      { name: 'from_location', type: 'text' },
      { name: 'to_location', type: 'text', required: true },
      { name: 'reason', type: 'text' },
      { name: 'operator', type: 'relation', collectionName: PB.users, maxSelect: 1, cascadeDelete: false },
      { name: 'operator_name', type: 'text' }
    ]
  },
  {
    name: PB.logs,
    type: 'base',
    listRule: STAFF_RULE,
    viewRule: STAFF_RULE,
    createRule: AUTH_RULE,
    updateRule: null,
    deleteRule: ADMIN_RULE,
    fields: [
      { name: 'action', type: 'text', required: true },
      { name: 'entity_type', type: 'text' },
      { name: 'entity_id', type: 'text' },
      { name: 'asset', type: 'relation', collectionName: PB.assets, maxSelect: 1, cascadeDelete: false },
      { name: 'actor', type: 'relation', collectionName: PB.users, maxSelect: 1, cascadeDelete: false },
      { name: 'actor_name', type: 'text' },
      { name: 'detail', type: 'json' }
    ]
  },
  {
    name: PB.settings,
    type: 'base',
    listRule: AUTH_RULE,
    viewRule: AUTH_RULE,
    createRule: ADMIN_RULE,
    updateRule: ADMIN_RULE,
    deleteRule: ADMIN_RULE,
    fields: [
      { name: 'require_loan_approval', type: 'bool' },
      { name: 'default_loan_days', type: 'number' },
      { name: 'allow_self_checkout', type: 'bool' },
      { name: 'updated_by', type: 'relation', collectionName: PB.users, maxSelect: 1, cascadeDelete: false }
    ]
  }
];
