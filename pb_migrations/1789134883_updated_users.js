/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_users_school_number` ON `users` (`school_number`)",
      "CREATE UNIQUE INDEX `idx_tokenKey__pb_users_auth_` ON `users` (`tokenKey`)",
      "CREATE UNIQUE INDEX `idx_email__pb_users_auth_` ON `users` (`email`) WHERE `email` != ''"
    ],
    "updateRule": "(@request.auth.id != \"\" && @request.auth.collectionName = \"users\" && id = @request.auth.id && @request.body.role:isset = false && @request.body.active:isset = false && @request.body.verified:isset = false) || @request.auth.id != \"\" && @request.auth.collectionName = \"users\" && @request.auth.role = \"admin\""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_tokenKey__pb_users_auth_` ON `users` (`tokenKey`)",
      "CREATE UNIQUE INDEX `idx_email__pb_users_auth_` ON `users` (`email`) WHERE `email` != ''"
    ],
    "updateRule": "(@request.auth.id != \"\" && @request.auth.collectionName = \"users\" && id = @request.auth.id && @request.body.role:changed = false && @request.body.active:changed = false && @request.body.verified:changed = false) || @request.auth.id != \"\" && @request.auth.collectionName = \"users\" && @request.auth.role = \"admin\""
  }, collection)

  return app.save(collection)
})
