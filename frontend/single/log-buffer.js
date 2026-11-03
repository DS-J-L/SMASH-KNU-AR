export class LogBuffer {
  constructor(limit=200) {this.limit=limit;this.entries=[];this.dropped=0;}
  add(entry) {if(this.entries.length>=this.limit){this.entries.shift();this.dropped++;}this.entries.push(structuredClone(entry));}
  export() {return {schema:'single-monitor-log.v1',dropped_log_count:this.dropped,entries:structuredClone(this.entries)};}
}
