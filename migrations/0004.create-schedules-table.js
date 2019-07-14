exports.up = (knex) => knex.schema.raw(`
CREATE TABLE core.schedules (
   -- Primary key
   id Serial,
   PRIMARY KEY (id),
   -- Core properties
   version_major Int NOT NULL,
   version_minor Int NOT NULL,
   schedule_json Jsonb NOT NULL,
   -- Foreign keys
   user_id Int NOT NULL REFERENCES core.users(id),
   plan_id Int NOT NULL REFERENCES core.plans(id)
);
`);

exports.down = (knex) => knex.schema.raw(
    'DROP TABLE IF EXISTS core.plans'
);