const ical = require('node-ical');
const config = require("config");
const Apihelper = require("./libs/apihelper");
const crypto = require('crypto')
const moment = require("moment")

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

/* Makes sure times end on the half-hour
 * t: a date/time
 * dir: 0 = round down; 1 = round up
 */
const ensureHalfHour = (t, dir) => {
    let d = new Date(t);
    let mins = d.getMinutes();
    if (mins !== 0 || mins !== 30) {
        if (dir === 1) {
            d.setMinutes(Math.ceil(mins / 30) * 30);
        } else {
            d.setMinutes(Math.floor(mins / 30) * 30);
        }
    }
    return d;
}

function test() {
    // const dateformat = dt => `${dt.getUTCFullYear()}-${dt.getUTCMonth() + 1}-${dt.getUTCDate()}T${dt.getUTCHours()}:${dt.getUTCMinutes()}:${dt.getUTCSeconds()}`;
    const dateformat = dt => moment(dt).format("YYYY-MM-DDThh:mm:ss")

    const test_data = [
        ["2020-01-01T08:00:00", "2020-01-01T08:00:00", "2020-01-01T08:00:00"],
        ["2020-01-01T08:30:00", "2020-01-01T08:30:00", "2020-01-01T08:30:00"],
        ["2020-01-01T08:15:00", "2020-01-01T08:00:00", "2020-01-01T08:30:00"],
        ["2020-01-01T08:45:00", "2020-01-01T08:30:00", "2020-01-01T09:00:00"],
    ]
    for (let d of test_data) {
        let low = dateformat(ensureHalfHour(d[0], 0));
        let high = dateformat(ensureHalfHour(d[0], 1));
        if (low !== d[1]) throw (`Low for ${d[0]} failed; expected ${d[1]}, got ${low}`);
        if (high !== d[2]) throw (`Low for ${d[0]} failed; expected ${d[2]}, got ${high}`);
    }
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
            let previousAppointments = (await apihelper.get("booking", { "filter[ical_source]": ical_source, "filter[start_time]": `$gte:${new Date().getTime()}` })).data;
            // Add or update events
            for (let i in events) {
                // console.log(events[event]);
                const event = events[i];
                const external_id = new Date(event.created) * 1 + "";
                if (new Date(event.start).getTime() < now.getTime()) continue;
                let start_time = ensureHalfHour(event.start, 0);
                let end_time = ensureHalfHour(event.end, 1);
                let data = {
                    start_time,
                    end_time,
                    location_id: event.location,
                    title: event.attendee.params.CN,
                    description: event.description,
                    external_id,
                    room_id: room._id,
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
                        if (previousAppointments[i].external_id === external_id) {
                            previousAppointments.splice(i, 1);
                        }
                    }
                } catch (err) {
                    console.error(new Date(), err);
                }
                // console.log(data);
            }
            for (let appointment of previousAppointments) {
                await apihelper.del("booking", appointment._id);
            }
            console.log("Deleted: ", previousAppointments);
        }
    } catch (err) {
        console.error(new Date(), err);
    }
}

try {
    test();
    main();
    setInterval(main, 1000 * 60 * config.interval);
} catch (err) {
    console.error(err);
}