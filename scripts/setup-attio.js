// `npm run setup-attio` - one-time: adds a multi-select "Events" field to
// People in Attio, so each person can be tagged with every event you met them at.
// Safe to run more than once.
import "dotenv/config";
import * as attio from "../src/attio.js";

if (await attio.eventsAttributeExists()) {
  console.log(`"Events" field already exists on People - nothing to do.`);
} else {
  await attio.createEventsAttribute();
  console.log(`Created the "Events" field on People in Attio.`);
}
