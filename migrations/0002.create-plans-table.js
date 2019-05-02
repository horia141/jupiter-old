exports.up = (knex, Promise) => knex.schema.raw(`
CREATE TABLE core.plans (
   -- Primary key
   id Serial,
   PRIMARY KEY (id),
   -- Core properties
   version VARCHAR(30) NOT NULL,
   plan JSONB NOT NULL
);
`);

exports.down = (knex, Promise) => knex.schema.raw(
    'DROP TABLE IF EXISTS core.plans'
);