export const quoteTransitions=Object.freeze({draft:["in_review"],in_review:["issued"],issued:["accepted","declined","expired","superseded"],accepted:[],declined:[],expired:[],superseded:[]});
export const assignmentTransitions=Object.freeze({none:["offered"],offered:["reserved","cancelled","expired"],reserved:["accepted","cancelled","expired"],accepted:["cancelled"],cancelled:[],expired:[]});
export const fulfilmentTransitions=Object.freeze({scheduled:["ready"],ready:["in_progress"],in_progress:["paused","completed"],paused:["in_progress"],completed:["validated"],validated:["closed"],closed:[]});
export function canTransition(map,from,to){return Array.isArray(map[from])&&map[from].includes(to)}
