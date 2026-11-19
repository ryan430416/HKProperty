/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  let collection;
  try {
    collection = app.findCollectionByNameOrId('hkp_loan_records');
  } catch {
    try {
      collection = app.findCollectionByNameOrId('loan_records');
    } catch {
      return;
    }
  }

  if (!collection.fields.find((field) => field.name === 'borrower_title')) {
    collection.fields.add(new Field({
      autogeneratePattern: '',
      hidden: false,
      id: 'text_borrower_title_hkp',
      max: 40,
      min: 0,
      name: 'borrower_title',
      pattern: '',
      presentable: false,
      primaryKey: false,
      required: false,
      system: false,
      type: 'text'
    }));
  }

  if (!collection.fields.find((field) => field.name === 'entry_source')) {
    collection.fields.add(new Field({
      hidden: false,
      id: 'select_entry_source_hkp',
      maxSelect: 1,
      name: 'entry_source',
      presentable: false,
      required: false,
      system: false,
      type: 'select',
      values: ['checkout', 'backfill']
    }));
  }

  const method = collection.fields.find((field) => field.name === 'checkout_method');
  if (method && Array.isArray(method.values) && !method.values.includes('backfill')) {
    method.values = [...method.values, 'backfill'];
  }

  return app.save(collection);
}, (app) => {
  let collection;
  try {
    collection = app.findCollectionByNameOrId('hkp_loan_records');
  } catch {
    try {
      collection = app.findCollectionByNameOrId('loan_records');
    } catch {
      return;
    }
  }
  try { collection.fields.removeById('text_borrower_title_hkp'); } catch { /* ignore */ }
  try { collection.fields.removeById('select_entry_source_hkp'); } catch { /* ignore */ }
  return app.save(collection);
});
