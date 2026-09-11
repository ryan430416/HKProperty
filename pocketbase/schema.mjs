/**
 * HKProperty PocketBase schema (source of truth).
 * Dedicated PocketBase instance required — do not share the default `users`
 * collection with unrelated apps.
 */

export const PB = {
  users: 'users',
  assets: 'assets',
  loans: 'loan_records',
  reservations: 'asset_reservations',
  usage: 'usage_records',
  audits: 'inventory_audits',
  locations: 'location_history',
  logs: 'operation_logs',
  settings: 'system_settings'
};

export const ROLES = ['borrower', 'staff', 'admin'];
export const AVAILABILITY = ['available', 'reserved', 'checked_out', 'overdue', 'maintenance', 'lost'];
export const LOAN_STATUSES = [
  'pending', 'approved', 'checked_out', 'overdue',
  'return_pending', 'returned', 'rejected', 'cancelled'
];
export const RESERVATION_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'converted'];
export const USAGE_TYPES = ['checkout', 'on_site', 'reservation_checkout', 'admin_record'];
export const RETURN_RESULTS = ['正常歸還', '有損壞', '配件缺少', '送修', '遺失'];
export const CHECKOUT_METHODS = ['self_service', 'admin', 'reservation'];

/** Logged-in user of this app's auth collection */
export const AUTH = `@request.auth.id != "" && @request.auth.collectionName = "${PB.users}"`;
export const STAFF = `${AUTH} && (@request.auth.role = "staff" || @request.auth.role = "admin")`;
export const ADMIN = `${AUTH} && @request.auth.role = "admin"`;
export const ACTIVE_USER = `${AUTH} && @request.auth.active = true`;

export const STAFF_RULE = STAFF;
export const AUTH_RULE = AUTH;
export const ADMIN_RULE = ADMIN;

export const USER_FIELDS = [
  { name: 'name', type: 'text', required: true },
  { name: 'school_number', type: 'text', required: true },
  { name: 'department', type: 'text' },
  { name: 'role', type: 'select', required: true, maxSelect: 1, values: ROLES },
  { name: 'active', type: 'bool' }
];

/** @deprecated alias */
export const USER_EXTRA_FIELDS = USER_FIELDS;

export const COLLECTIONS = [
  {
    name: PB.users,
    type: 'auth',
    listRule: `${ADMIN} || (${AUTH} && id = @request.auth.id) || ${STAFF}`,
    viewRule: `${ADMIN} || (${AUTH} && id = @request.auth.id) || ${STAFF}`,
    createRule: '',
    updateRule: `(${AUTH} && id = @request.auth.id && @request.body.role:isset = false && @request.body.active:isset = false && @request.body.verified:isset = false) || ${ADMIN}`,
    deleteRule: ADMIN,
    indexes: [
      `CREATE UNIQUE INDEX \`idx_${PB.users}_school_number\` ON \`${PB.users}\` (\`school_number\`)`
    ],
    fields: USER_FIELDS
  },
  {
    name: PB.assets,
    type: 'base',
    listRule: `${AUTH} && active = true`,
    viewRule: `${AUTH} && active = true`,
    createRule: ADMIN,
    updateRule: STAFF,
    deleteRule: ADMIN,
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
      { name: 'asset_status', type: 'select', maxSelect: 1, values: ['normal', 'abnormal'] },
      { name: 'availability_status', type: 'select', required: true, maxSelect: 1, values: AVAILABILITY },
      { name: 'usage_count', type: 'number', min: 0 },
      { name: 'note', type: 'text' },
      { name: 'brand', type: 'text' },
      { name: 'model', type: 'text' },
      {
        name: 'image',
        type: 'file',
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        protected: false
      },
      { name: 'borrowable', type: 'bool' },
      { name: 'active', type: 'bool' },
      { name: 'audit_status', type: 'text' },
      { name: 'last_audit_at', type: 'date' },
      { name: 'return_alert', type: 'text' }
    ]
  },
  {
    name: PB.loans,
    type: 'base',
    listRule: `${STAFF} || (${AUTH} && borrower = @request.auth.id)`,
    viewRule: `${STAFF} || (${AUTH} && borrower = @request.auth.id)`,
    createRule: null,
    updateRule: null,
    deleteRule: ADMIN,
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
      { name: 'return_result', type: 'select', maxSelect: 1, values: RETURN_RESULTS },
      { name: 'return_location', type: 'text' },
      { name: 'checkout_method', type: 'select', maxSelect: 1, values: CHECKOUT_METHODS },
      { name: 'checkout_operator', type: 'text' },
      { name: 'return_operator', type: 'text' },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: LOAN_STATUSES },
      { name: 'rejection_reason', type: 'text' },
      { name: 'note', type: 'text' }
    ]
  },
  {
    name: PB.reservations,
    type: 'base',
    listRule: `${STAFF} || (${AUTH} && user = @request.auth.id)`,
    viewRule: `${STAFF} || (${AUTH} && user = @request.auth.id)`,
    createRule: null,
    updateRule: null,
    deleteRule: ADMIN,
    indexes: [
      `CREATE UNIQUE INDEX \`idx_${PB.reservations}_number\` ON \`${PB.reservations}\` (\`reservation_number\`)`
    ],
    fields: [
      { name: 'reservation_number', type: 'text', required: true },
      { name: 'asset', type: 'relation', required: true, collectionName: PB.assets, maxSelect: 1, cascadeDelete: false },
      { name: 'user', type: 'relation', required: true, collectionName: PB.users, maxSelect: 1, cascadeDelete: false },
      { name: 'purpose', type: 'text', required: true },
      { name: 'start_at', type: 'date', required: true },
      { name: 'end_at', type: 'date', required: true },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: RESERVATION_STATUSES },
      { name: 'approved_by', type: 'relation', collectionName: PB.users, maxSelect: 1, cascadeDelete: false },
      { name: 'approved_at', type: 'date' },
      { name: 'rejection_reason', type: 'text' },
      { name: 'converted_loan', type: 'relation', collectionName: PB.loans, maxSelect: 1, cascadeDelete: false },
      { name: 'contact', type: 'text' },
      { name: 'note', type: 'text' }
    ]
  },
  {
    name: PB.usage,
    type: 'base',
    listRule: `${STAFF} || (${AUTH} && user = @request.auth.id)`,
    viewRule: `${STAFF} || (${AUTH} && user = @request.auth.id)`,
    createRule: null,
    updateRule: null,
    deleteRule: ADMIN,
    indexes: [
      `CREATE UNIQUE INDEX \`idx_${PB.usage}_number\` ON \`${PB.usage}\` (\`usage_number\`)`,
      `CREATE UNIQUE INDEX \`idx_${PB.usage}_idem\` ON \`${PB.usage}\` (\`idempotency_key\`)`
    ],
    fields: [
      { name: 'usage_number', type: 'text', required: true },
      { name: 'asset', type: 'relation', required: true, collectionName: PB.assets, maxSelect: 1, cascadeDelete: false },
      { name: 'user', type: 'relation', collectionName: PB.users, maxSelect: 1, cascadeDelete: false },
      { name: 'loan', type: 'relation', collectionName: PB.loans, maxSelect: 1, cascadeDelete: false },
      { name: 'reservation', type: 'relation', collectionName: PB.reservations, maxSelect: 1, cascadeDelete: false },
      { name: 'usage_type', type: 'select', required: true, maxSelect: 1, values: USAGE_TYPES },
      { name: 'user_name', type: 'text', required: true },
      { name: 'department', type: 'text' },
      { name: 'purpose', type: 'text', required: true },
      { name: 'used_at', type: 'date', required: true },
      { name: 'location', type: 'text' },
      { name: 'recorded_by', type: 'relation', collectionName: PB.users, maxSelect: 1, cascadeDelete: false },
      { name: 'idempotency_key', type: 'text', required: true },
      { name: 'note', type: 'text' }
    ]
  },
  {
    name: PB.audits,
    type: 'base',
    listRule: STAFF,
    viewRule: STAFF,
    createRule: null,
    updateRule: null,
    deleteRule: ADMIN,
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
    listRule: STAFF,
    viewRule: STAFF,
    createRule: null,
    updateRule: null,
    deleteRule: ADMIN,
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
    listRule: STAFF,
    viewRule: STAFF,
    createRule: null,
    updateRule: null,
    deleteRule: ADMIN,
    fields: [
      { name: 'action', type: 'text', required: true },
      { name: 'entity_type', type: 'text' },
      { name: 'entity_id', type: 'text' },
      { name: 'asset', type: 'relation', collectionName: PB.assets, maxSelect: 1, cascadeDelete: false },
      { name: 'loan', type: 'relation', collectionName: PB.loans, maxSelect: 1, cascadeDelete: false },
      { name: 'reservation', type: 'relation', collectionName: PB.reservations, maxSelect: 1, cascadeDelete: false },
      { name: 'actor', type: 'relation', collectionName: PB.users, maxSelect: 1, cascadeDelete: false },
      { name: 'actor_name', type: 'text' },
      { name: 'summary', type: 'text' },
      { name: 'detail', type: 'json' }
    ]
  },
  {
    name: PB.settings,
    type: 'base',
    listRule: AUTH,
    viewRule: AUTH,
    createRule: ADMIN,
    updateRule: ADMIN,
    deleteRule: ADMIN,
    fields: [
      { name: 'require_loan_approval', type: 'bool' },
      { name: 'allow_self_checkout', type: 'bool' },
      { name: 'default_loan_days', type: 'number' },
      { name: 'updated_by', type: 'relation', collectionName: PB.users, maxSelect: 1, cascadeDelete: false }
    ]
  }
];
