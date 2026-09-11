/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1321337024")

  // add field
  collection.fields.addAt(24, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_3846869556",
    "help": "",
    "hidden": false,
    "id": "relation174089317",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "current_loan",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1321337024")

  // remove field
  collection.fields.removeById("relation174089317")

  return app.save(collection)
})
