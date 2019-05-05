exports.up = (knex) => knex.schema.raw(`
CREATE TABLE core.plans (
   -- Primary key
   id Serial,
   PRIMARY KEY (id),
   -- Core properties
   version_major Int NOT NULL,
   version_minor Int NOT NULL,
   plan Jsonb NOT NULL,
   -- Foreign keys
   user_id Int NOT NULL
);
`);

exports.down = (knex) => knex.schema.raw(
    'DROP TABLE IF EXISTS core.plans'
);