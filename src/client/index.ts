import { ServiceClient } from "../shared/dsrpc";

const client = ServiceClient.build("http://localhost:3000/api");

async function main() {
    //const user = await client.do("getOrCreateUser", { email: "horia@foo.com", password: "bar" });
    //console.log(user);

    const user2 = await client.do("getUser", {});
    console.log(user2);
}


main();
