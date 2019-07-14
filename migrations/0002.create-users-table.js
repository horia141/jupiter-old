exports.up = (knex) => knex.schema.raw(`
CREATE TABLE core.users (
   -- Primary key
   id Serial,
   PRIMARY KEY (id),
   -- Core properties
   user_json Jsonb NOT NULL
);
`);

exports.down = (knex) => knex.schema.raw(
    'DROP TABLE IF EXISTS core.users'
);