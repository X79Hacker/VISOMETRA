import {computeFourier} from './core.js';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,result:computeFourier(data.loops,data.order)});}catch(error){self.postMessage({id:data.id,error:error.message});}};
