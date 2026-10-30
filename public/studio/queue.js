// One model job at a time. A bad image does not stop the remaining queue.
export async function executeBatch(items,{process,shouldStop=()=>false,onFailure=()=>{},onProgress=()=>{}}){
 let completed=0,failed=0;
 for(const item of items){
  if(shouldStop())break;
  try{await process(item);if(shouldStop())break;completed++;}
  catch(error){if(shouldStop())break;failed++;await onFailure(item,error);}
  await onProgress(item);
 }
 return{completed,failed,stopped:!!shouldStop()};
}
