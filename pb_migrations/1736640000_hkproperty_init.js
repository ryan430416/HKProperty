/// <reference path="../pb_data/types.d.ts" />
/**
 * HKProperty initial collections.
 * Run with PocketBase from project root so this folder is picked up as pb_migrations.
 */
migrate((app) => {
  const existing = app.findAllCollections().map((c) => c.name);

  function ensure(payload) {
    if (existing.includes(payload.name)) {
      const col = app.findCollectionByNameOrId(payload.name);
      // Only merge missing fields; do not wipe foreign apps' data.
      const have = new Set((col.fields || []).map((f) => f.name));
      for (const field of payload.fields || []) {
        if (!have.has(field.name) && field.name !== 'id') {
          col.fields.push(new Field(field));
        }
      }
      if (payload.listRule !== undefined) col.listRule = payload.listRule;
      if (payload.viewRule !== undefined) col.viewRule = payload.viewRule;
      if (payload.createRule !== undefined) col.createRule = payload.createRule;
      if (payload.updateRule !== undefined) col.updateRule = payload.updateRule;
      if (payload.deleteRule !== undefined) col.deleteRule = payload.deleteRule;
      app.save(col);
      return;
    }
    const col = new Collection(payload);
    app.save(col);
  }

  const AUTH = '@request.auth.id != "" && @request.auth.collectionName = "users"';
  const STAFF = AUTH + ' && (@request.auth.role = "staff" || @request.auth.role = "admin")';
  const ADMIN = AUTH + ' && @request.auth.role = "admin"';

  // Extend default auth collection "users" if present, else create.
  if (existing.includes('users')) {
    const users = app.findCollectionByNameOrId('users');
    const have = new Set((users.fields || []).map((f) => f.name));
    const extras = [
      { name: 'name', type: 'text', required: true },
      { name: 'school_number', type: 'text', required: true },
      { name: 'department', type: 'text' },
      { name: 'role', type: 'select', required: true, maxSelect: 1, values: ['borrower', 'staff', 'admin'] },
      { name: 'active', type: 'bool' }
    ];
    for (const field of extras) {
      if (!have.has(field.name)) users.fields.push(new Field(field));
    }
    users.listRule = ADMIN + ' || (' + AUTH + ' && id = @request.auth.id) || ' + STAFF;
    users.viewRule = users.listRule;
    users.createRule = '';
    users.updateRule = '(' + AUTH + ' && id = @request.auth.id && @request.body.role:changed = false && @request.body.active:changed = false && @request.body.verified:changed = false) || ' + ADMIN;
    users.deleteRule = ADMIN;
    app.save(users);
  } else {
    ensure({
      type: 'auth',
      name: 'users',
      listRule: ADMIN + ' || (' + AUTH + ' && id = @request.auth.id) || ' + STAFF,
      viewRule: ADMIN + ' || (' + AUTH + ' && id = @request.auth.id) || ' + STAFF,
      createRule: '',
      updateRule: '(' + AUTH + ' && id = @request.auth.id && @request.body.role:changed = false && @request.body.active:changed = false && @request.body.verified:changed = false) || ' + ADMIN,
      deleteRule: ADMIN,
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'school_number', type: 'text', required: true },
        { name: 'department', type: 'text' },
        { name: 'role', type: 'select', required: true, maxSelect: 1, values: ['borrower', 'staff', 'admin'] },
        { name: 'active', type: 'bool' }
      ]
    });
  }

  // Remaining collections are created/updated by scripts/setup-pocketbase.mjs
  // for Admin API compatibility on remote hosts. Local migrate marks schema version.
}, (app) => {
  // Non-destructive down migration: leave collections in place to protect data.
});
