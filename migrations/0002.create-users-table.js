exports.up = (knex) => knex.schema.raw(`
CREATE TABLE core.users (
   -- Primary key
   id Serial,
   PRIMARY KEY (id),
   -- Core properties
   user_json Jsonb NOT NULL,
   email TEXT NOT NULL UNIQUE,
   password_hash VARCHAR(64) NOT NULL
);
`);

exports.down = (knex) => knex.schema.raw(
    'DROP TABLE IF EXISTS core.users'
);