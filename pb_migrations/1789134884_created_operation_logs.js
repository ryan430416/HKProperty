/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
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
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text1204587666",
        "max": 0,
        "min": 0,
        "name": "action",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text3289574914",
        "max": 0,
        "min": 0,
        "name": "entity_type",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text2166717789",
        "max": 0,
        "min": 0,
        "name": "entity_id",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_1321337024",
        "help": "",
        "hidden": false,
        "id": "relation45046364",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "asset",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_3846869556",
        "help": "",
        "hidden": false,
        "id": "relation3318942979",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "loan",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_322407982",
        "help": "",
        "hidden": false,
        "id": "relation1120422229",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "reservation",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "_pb_users_auth_",
        "help": "",
        "hidden": false,
        "id": "relation1148540665",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "actor",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text1852525813",
        "max": 0,
        "min": 0,
        "name": "actor_name",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text3458754147",
        "max": 0,
        "min": 0,
        "name": "summary",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "",
        "hidden": false,
        "id": "json772177811",
        "maxSize": 0,
        "name": "detail",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      }
    ],
    "id": "pbc_4162121306",
    "indexes": [],
    "listRule": "@request.auth.id != \"\" && @request.auth.collectionName = \"users\" && (@request.auth.role = \"staff\" || @request.auth.role = \"admin\")",
    "name": "operation_logs",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": "@request.auth.id != \"\" && @request.auth.collectionName = \"users\" && (@request.auth.role = \"staff\" || @request.auth.role = \"admin\")"
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4162121306");

  return app.delete(collection);
})
