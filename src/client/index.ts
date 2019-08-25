import { ServiceClient } from "../shared/dsrpc";

const client = new ServiceClient("http://localhost:3000/api");

client.do("getOrCreateUser", { email: "horia@foo.com", password: "bar" }).then(r => {
    console.log(r);
}).catch(e => {
    console.log(e);
});
