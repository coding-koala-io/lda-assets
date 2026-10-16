import {Store} from '../../src/store.js';
// Delay only the test's background save; production CLI and signal handlers are unchanged.
Store.prototype.changed=function(){this.dirty=true;};
process.on('message',({signal})=>{process.emit(signal);process.disconnect();});
