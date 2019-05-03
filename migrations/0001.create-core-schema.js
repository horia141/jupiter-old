exports.up = (knex) => knex.schema.raw(
    'CREATE SCHEMA core'
);

exports.down = (knex) => knex.schema.raw(
    'DROP SCHEMA IF EXISTS core'
);