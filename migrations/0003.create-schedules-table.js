exports.up = (knex) => knex.schema.raw(`
CREATE TABLE core.schedules (
   -- Primary key
   id Serial,
   PRIMARY KEY (id),
   -- Core properties
   schedules Jsonb NOT NULL,
   -- Foreign keys
   user_id Int NOT NULL,
   plan_id Int NOT NULL REFERENCES core.plans(id)
);
`);

exports.down = (knex) => knex.schema.raw(
    'DROP TABLE IF EXISTS core.plans'
);