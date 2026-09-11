/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": "@request.auth.id != \"\" && @request.auth.collectionName = \"users\" && @request.auth.role = \"admin\"",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.collectionName = \"users\" && @request.auth.role = \"admin\"",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "help": "",
        "hidden": false,
        "id": "bool257729112",
        "name": "require_loan_approval",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "bool"
      },
      {
        "help": "",
        "hidden": false,
        "id": "bool1992890996",
        "name": "allow_self_checkout",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "bool"
      },
      {
        "help": "",
        "hidden": false,
        "id": "number2871766709",
        "max": null,
        "min": null,
        "name": "default_loan_days",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "cascadeDelete": false,
        "collectionId": "_pb_users_auth_",
        "help": "",
        "hidden": false,
        "id": "relation385774305",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "updated_by",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      }
    ],
    "id": "pbc_3806592213",
    "indexes": [],
    "listRule": "@request.auth.id != \"\" && @request.auth.collectionName = \"users\"",
    "name": "system_settings",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.id != \"\" && @request.auth.collectionName = \"users\" && @request.auth.role = \"admin\"",
    "viewRule": "@request.auth.id != \"\" && @request.auth.collectionName = \"users\""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3806592213");

  return app.delete(collection);
})
