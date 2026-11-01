import {matchTranslation} from './tracking-core.js';
onmessage=({data})=>{try{postMessage({result:matchTranslation(data.previous,data.current,data.mask,data.width,data.height,data.options)});}catch(error){postMessage({error:error.message});}};
