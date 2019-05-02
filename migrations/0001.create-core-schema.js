exports.up = (knex, Promise) => knex.schema.raw(
    'CREATE SCHEMA core'
);

exports.down = (knex, Promise) => knex.schema.raw(
    'DROP SCHEMA IF EXISTS core'
);