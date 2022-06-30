import { hri } from 'human-readable-ids';
import Debug from 'debug';

import Client from './Client';
import TunnelAgent from './TunnelAgent';

// Manage sets of clients
//
// A client is a "user session" established to service a remote localtunnel client
class ClientManager {
    constructor(opt) {
        this.opt = opt || {};

        // id -> client instance
        this.clients = new Map();

        // statistics
        this.stats = {
            tunnels: 0
        };

        this.debug = Debug('lt:ClientManager');

        // This is totally wrong :facepalm: this needs to be per-client...
        this.graceTimeout = null;

        //maximum number of clients per ip
        this.maxClient = 5;
    }

    // create a new tunnel with `id`
    // if the id is already used, a random id is assigned
    // if the tunnel could not be created, throws an error
    async newClient(id, password = null, ip = null) {
        const clients = this.clients;
        const stats = this.stats;

        //check if the ip has max client
        if(ip && this.countIp(ip) >= this.maxClient){
            throw "you have used the maximum clients available for each ip";
        }

        // can't ask for id already is use
        if (clients[id]) {
            if(password != null){
                //if the request is comming from the same user 
                //or the previous user is not using apassword
                //give access current user
                if(clients[id].password != null){
                    if(clients[id].password == password){
                        //overwrite the original
                        this.removeClient(id)
                    }
                    else{
                        //keep the original
                        id = hri.random();
                    }
                }
                else{
                    //overwrite the original
                    this.removeClient(id)
                }
            }
            else{
                //keep the original
                id = hri.random();
            }
        }

        const maxSockets = this.opt.max_tcp_sockets;
        const agent = new TunnelAgent({
            clientId: id,
            maxSockets: 10,
        });

        const client = new Client({
            id,
            agent,
            password,
            ip,
        });

        // add to clients map immediately
        // avoiding races with other clients requesting same id
        clients[id] = client;

        client.once('close', () => {
            this.removeClient(id);
        });

        // try/catch used here to remove client id
        try {
            const info = await agent.listen();
            ++stats.tunnels;
            return {
                id: id,
                port: info.port,
                max_conn_count: maxSockets,
            };
        }
        catch (err) {
            this.removeClient(id);
            // rethrow error for upstream to handle
            throw err;
        }
    }

    removeClient(id) {
        this.debug('removing client: %s', id);
        const client = this.clients[id];
        if (!client) {
            return;
        }
        --this.stats.tunnels;
        delete this.clients[id];
        client.close();
    }

    hasClient(id) {
        return !!this.clients[id];
    }

    getClient(id) {
        return this.clients[id];
    }

    countIp(ip){
        let count = 0;
        for (var key in this.clients) {
            this.clients[key].ip == ip ? count++ : null;
        }
        console.log(ip)
        console.log(count)
        return count;
    }
}

export default ClientManager;
