const ical = require('node-ical');
const config = require("config");
const Apihelper = require("./libs/apihelper");
const crypto = require('crypto')

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
        const now = new Date();
        const rooms = await getRooms();
        for (let room of rooms) {
            console.log(`Fetching ${room.external_ical}`);
            var events = await getiCalUrl(room.external_ical);
            const ical_source = crypto.createHash('md5').update(room.external_ical).digest("hex");
            console.log({ ical_source });
            let previousAppointments = (await apihelper.get("booking", { "filter[ical_source]": ical_source, "filter[start_time]": `$gte:${ new Date().getTime() }` })).data;
            // Add or update events
            for (let i in events) {
                // console.log(events[event]);
                const event = events[i];
                const external_id = new Date(event.created) * 1 + "";
                if (new Date(event.start).getTime() < now.getTime()) continue;
                let data = {
                    start_time: new Date(event.start),
                    end_time: new Date(event.end),
                    location: event.location,
                    title: event.attendee.params.CN,
                    description: event.description,
                    external_id,
                    room: room._id,
                    hidden: true,
                    ical_source,
                }
                // console.log(data);
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
                    for (let i = 0; i < previousAppointments.length; i++) {
                        if ( previousAppointments[i].external_id === external_id) {
                            previousAppointments.splice(i, 1);
                        }
                    }
                } catch(err) {
                    console.error(new Date(), err);
                }
                // console.log(data);
            }
            for (let appointment of previousAppointments) {
                await apihelper.del("booking", appointment._id);
            }
            console.log("Deleted: ", previousAppointments);
        }
    } catch(err) {
        console.error(new Date(), err);
    }
}

main();

setInterval(main, 1000 * 60 * config.interval);