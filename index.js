const ical = require('node-ical');
const axios = require("axios");
const config = require("config");
const Apihelper = require("./libs/apihelper");

const apihelper = new Apihelper({ apikey: config.apikey });

async function getRooms() {
    return (await apihelper.get("room")).data.filter(room => (room.external_ical));
}

function getiCalUrl(url) {
    return new Promise((resolve, reject) => {
        ical.fromURL(url, {}, (err, data) => {
            if (err) return reject(err);
            return resolve(data);
        });
    });
}

async function main() {
    try {
        const rooms = await getRooms();
        for (let room of rooms) {
            var events = await getiCalUrl(room.external_ical);
            for (event in events) {
                let data = {
                    start_time: new Date(events[event].start),
                    end_time: new Date(events[event].end),
                    location: events[event].location,
                    title: events[event].attendee.params.CN,
                    description: events[event].description,
                    external_id: events[event].uid,
                    room: room._id,
                }
                try {
                    let previousQuery = await apihelper.get("booking", { "filter[external_id]": data.external_id });
                    if (previousQuery.count) {
                        let previous = previousQuery.data.pop();
                        let update = false;
                        if (new Date(data.start_time).getTime() !== new Date(previous.start_time).getTime()) update = true;
                        if (new Date(data.end_time).getTime() !== new Date(previous.end_time).getTime()) update = true;
                        if (data.title !== previous.title) update = true;
                        if (data.description !== previous.description) update = true;
                        if (update) {
                            await apihelper.put("booking", previous._id, data);
                        }
                    } else {
                        await apihelper.post("booking", data);
                    }
                } catch(err) {
                    console.error(new Date(), err);
                }
                // console.log(data);
            }
        }
    } catch(err) {
        console.error(new Date(), err);
    }
}

main();

setInterval(main, 1000 * 60 * config.interval);