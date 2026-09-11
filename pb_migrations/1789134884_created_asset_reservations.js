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
        "id": "text3730921167",
        "max": 0,
        "min": 0,
        "name": "reservation_number",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
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
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "_pb_users_auth_",
        "help": "",
        "hidden": false,
        "id": "relation2375276105",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "user",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text3095901163",
        "max": 0,
        "min": 0,
        "name": "purpose",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "help": "",
        "hidden": false,
        "id": "date3075695607",
        "max": "",
        "min": "",
        "name": "start_at",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "date"
      },
      {
        "help": "",
        "hidden": false,
        "id": "date936579196",
        "max": "",
        "min": "",
        "name": "end_at",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "date"
      },
      {
        "help": "",
        "hidden": false,
        "id": "select2063623452",
        "maxSelect": 1,
        "name": "status",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "select",
        "values": [
          "pending",
          "approved",
          "rejected",
          "cancelled",
          "expired",
          "converted"
        ]
      },
      {
        "cascadeDelete": false,
        "collectionId": "_pb_users_auth_",
        "help": "",
        "hidden": false,
        "id": "relation1319357245",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "approved_by",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "help": "",
        "hidden": false,
        "id": "date457172035",
        "max": "",
        "min": "",
        "name": "approved_at",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "date"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text2909529734",
        "max": 0,
        "min": 0,
        "name": "rejection_reason",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_3846869556",
        "help": "",
        "hidden": false,
        "id": "relation181331198",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "converted_loan",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text1281549880",
        "max": 0,
        "min": 0,
        "name": "contact",
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
        "id": "text3485334036",
        "max": 0,
        "min": 0,
        "name": "note",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      }
    ],
    "id": "pbc_322407982",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_asset_reservations_number` ON `asset_reservations` (`reservation_number`)"
    ],
    "listRule": "@request.auth.id != \"\" && @request.auth.collectionName = \"users\" && (@request.auth.role = \"staff\" || @request.auth.role = \"admin\") || (@request.auth.id != \"\" && @request.auth.collectionName = \"users\" && user = @request.auth.id)",
    "name": "asset_reservations",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": "@request.auth.id != \"\" && @request.auth.collectionName = \"users\" && (@request.auth.role = \"staff\" || @request.auth.role = \"admin\") || (@request.auth.id != \"\" && @request.auth.collectionName = \"users\" && user = @request.auth.id)"
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_322407982");

  return app.delete(collection);
})
