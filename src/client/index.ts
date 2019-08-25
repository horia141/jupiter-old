import { ServiceClient } from "../dsrpc";

const client = new ServiceClient("http://localhost:3000/api");

client.do("getOrCreateUser", { x: 10, y: 20}).then(r => {
    console.log(r);
}).catch(e => {
    console.log(e);
});
