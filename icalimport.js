const fs = require("fs")
const ical = require('node-ical');

const events = ical.parseFile("icalimport.ics");
// console.log(events)
for (event in events) {
    let start_time = new Date(events[event].start);
    let end_time = new Date(events[event].end);
    let location = events[event].location;
    let title = events[event].attendee.params.CN);
    let description = events[event].description;
}
