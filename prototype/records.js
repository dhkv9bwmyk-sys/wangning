(function(root){
  'use strict';
  const stores=['tasks','chats','docs','notices','system','handoffs','fulltimeTasks'];
  const initial=chatId=>({id:chatId,seq:0,rows:[],requests:[]});
  let db=null,temporary=false;
  const memory=Object.fromEntries(stores.map(s=>[s,new Map()]));
  function migrateSystems(transaction){
    const systems=transaction.objectStore('system');
    const legacy=systems.get('campus');
    legacy.onsuccess=()=>{
      const previous=legacy.result;
      if(!previous)return;
      const tasks=transaction.objectStore('tasks').getAll();
      tasks.onsuccess=()=>{
        const rows=new Map(previous.rows.map(row=>[row.record_id,row]));
        const requests=new Map(previous.requests);
        const ledgers=new Map();
        for(const task of tasks.result){
          if(!task.chatId||!task.receipt)continue;
          if(!ledgers.has(task.chatId))ledgers.set(task.chatId,{...initial(task.chatId),seq:previous.seq});
          const ledger=ledgers.get(task.chatId);
          ledger.rows.push(...task.receipt.ids.map(id=>rows.get(id)).filter(Boolean));
          const key=task.id+':'+(task.seal?.version??task.version);
          if(requests.has(key))ledger.requests.push([key,requests.get(key)]);
        }
        for(const ledger of ledgers.values())systems.put(ledger);
      };
    };
  }
  function init(){return new Promise(resolve=>{
    if(!root.indexedDB){temporary=true;resolve();return;}
    let req;try{req=indexedDB.open('academic-desk-v1',4);}catch{temporary=true;resolve();return;}
    req.onupgradeneeded=event=>{
      for(const s of stores)if(!req.result.objectStoreNames.contains(s))req.result.createObjectStore(s,{keyPath:'id'});
      if(event.oldVersion>0&&event.oldVersion<3)migrateSystems(req.transaction);
    };
    req.onsuccess=()=>{db=req.result;db.onversionchange=()=>db.close();resolve();};
    req.onerror=()=>{temporary=true;resolve();};
  });}
  const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
  function all(store){if(!db)return Promise.resolve([...memory[store].values()].map(clone));return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  function loadSystem(chatId){
    if(!db)return Promise.resolve(clone(memory.system.get(chatId))||initial(chatId));
    return new Promise((resolve,reject)=>{
      const request=db.transaction('system').objectStore('system').get(chatId);
      request.onsuccess=()=>resolve(request.result||initial(chatId));
      request.onerror=()=>reject(request.error);
    });
  }
  function put(store,value){if(!db){memory[store].set(value.id,clone(value));return Promise.resolve();}return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||Error('记录保存失败'));});}
  const missingChat=id=>Object.assign(Error('这段会话已删除。'),{chatId:id});
  const messageTask=message=>message.taskId??message.task;
  function withoutTaskMessages(chat,remove){
    const affected=message=>messageTask(message)&&remove(messageTask(message));
    const messages=chat.messages.filter((message,index,history)=>{
      if(affected(message))return false;
      const reply=history[index+1];
      // Older uploads were stored immediately before their tagged intake result.
      if(message.role!=='user'||messageTask(message)||!message.attachments?.length||reply?.role!=='assistant'||!affected(reply))return true;
      if(reply.fileRequest)return !reply.filePreview||reply.filePreview.length!==message.attachments.length||
        reply.filePreview.some((file,i)=>file.name!==message.attachments[i]);
      return !(reply.fileAnalysis===true||['补充设班资料','整理班级资料'].includes(message.text));
    });
    const focus=chat.focus&&remove(chat.focus)?'':chat.focus;
    let pending=chat.pending;
    if(pending?.task&&remove(pending.task))pending=null;
    else if(pending?.type==='task'){
      const ids=pending.ids.filter(id=>!remove(id));
      if(ids.length!==pending.ids.length)pending=ids.length?{...pending,ids}:null;
    }
    return messages.length===chat.messages.length&&focus===chat.focus&&pending===chat.pending?chat:{...chat,messages,focus,pending};
  }
  function saveChatWith(chat,store,record,replace){
    const checkTasks=chat.area==='schedule'&&(chat.focus||chat.pending?.task||chat.pending?.type==='task'||chat.messages.some(messageTask));
    let saved=record;
    if(!db){
      if(!memory.chats.has(chat.id))return Promise.reject(missingChat(chat.id));
      if(store){
        if(replace)saved=replace(memory[store].get(record.id),record);
        memory[store].set(record.id,clone(saved));
      }
      const current=checkTasks?withoutTaskMessages(chat,id=>!memory.tasks.has(id)):chat;
      memory.chats.set(chat.id,clone(current));
      return Promise.resolve(saved);
    }
    return new Promise((resolve,reject)=>{
      const transactionStores=new Set(['chats']);
      if(store)transactionStores.add(store);
      if(checkTasks)transactionStores.add('tasks');
      const tx=db.transaction([...transactionStores],'readwrite');
      const chats=tx.objectStore('chats'),existing=chats.getKey(chat.id);
      let error;
      existing.onsuccess=()=>{
        if(existing.result===undefined){error=missingChat(chat.id);tx.abort();return;}
        if(store){
          const records=tx.objectStore(store);
          if(replace){
            const previous=records.get(record.id);
            previous.onsuccess=()=>{
              try{
                saved=replace(previous.result,record);
                if(saved!==previous.result)records.put(saved);
              }catch(cause){error=cause;tx.abort();}
            };
          }else records.add(record);
        }
        if(checkTasks){
          const lookup=tx.objectStore('tasks').getAllKeys();
          lookup.onsuccess=()=>{
            const active=new Set(lookup.result);
            chats.put(withoutTaskMessages(chat,id=>!active.has(id)));
          };
        }else chats.put(chat);
      };
      tx.oncomplete=()=>resolve(saved);
      tx.onabort=tx.onerror=()=>reject(error||tx.error||Error('记录保存失败'));
    });
  }
  function saveChat(chat,task){return saveChatWith(chat,task?'tasks':null,task);}
  function createIntake(task,chat){return saveChat(chat,task);}
  function updateIntake(task,chat,etag){
    return saveChatWith(chat,'tasks',{...task,etag:etag+1},(previous,next)=>{
      if(!previous||previous.etag!==etag||previous.receipt||previous.hiddenFromList||previous.chatId!==chat.id){
        throw Error('这项任务已有新记录，请再次查看。');
      }
      return next;
    });
  }
  function createHandoff(ticket,chat,replace=false){
    return saveChatWith(chat,'handoffs',ticket,replace?(previous,next)=>previous?.notification?.status==='sent'?previous:next:undefined);
  }
  async function editHandoff(id,mutate){
    function apply(ticket){
      if(!ticket)throw Error('这项工单暂不可用。');
      return mutate(ticket);
    }
    if(!db){
      const next=apply(clone(memory.handoffs.get(id)));
      memory.handoffs.set(id,clone(next));
      return next;
    }
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('handoffs','readwrite'),store=tx.objectStore('handoffs');
      const current=store.get(id);
      let next,error;
      current.onsuccess=()=>{
        try{next=apply(current.result);store.put(next);}
        catch(cause){error=cause;tx.abort();}
      };
      tx.oncomplete=()=>resolve(next);
      tx.onabort=tx.onerror=()=>reject(error||tx.error||Error('工单状态暂未更新。'));
    });
  }
  function removeChat(id,replacement){
    if(!db){
      memory.chats.delete(id);
      if(replacement)memory.chats.set(replacement.id,clone(replacement));
      return Promise.resolve();
    }
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('chats','readwrite'),chats=tx.objectStore('chats');
      chats.delete(id);
      if(replacement)chats.add(replacement);
      tx.oncomplete=resolve;
      tx.onabort=tx.onerror=()=>reject(tx.error||Error('会话删除失败，请重试。'));
    });
  }
  async function removeSetupTask(id,etag){
    function ownerOf(task){
      if(!task||task.etag!==etag||task.hiddenFromList||task.receipt)throw Error('任务状态已变化，请刷新后再操作。');
      return task.chatId;
    }
    function clean(chat,chatId){
      if(!chat)throw missingChat(chatId);
      return {...withoutTaskMessages(chat,taskId=>taskId===id),updated:new Date().toISOString()};
    }
    if(!db){
      const chatId=ownerOf(memory.tasks.get(id));
      const updated=clean(clone(memory.chats.get(chatId)),chatId);
      memory.chats.set(chatId,clone(updated));
      memory.tasks.delete(id);
      return updated;
    }
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['tasks','chats'],'readwrite');
      const tasks=tx.objectStore('tasks'), chats=tx.objectStore('chats'), current=tasks.get(id);
      let updated,error;
      current.onsuccess=()=>{
        try{
          const chatId=ownerOf(current.result), owner=chats.get(chatId);
          owner.onsuccess=()=>{
            try{
              updated=clean(owner.result,chatId);
              chats.put(updated);
              tasks.delete(id);
            }catch(cause){error=cause;tx.abort();}
          };
        }catch(cause){error=cause;tx.abort();}
      };
      tx.oncomplete=()=>resolve(updated);
      tx.onabort=tx.onerror=()=>reject(error||tx.error||Error('任务删除失败，请重试。'));
    });
  }
  async function changeTask(store,id,mutate){
    const apply=task=>{
      if(!task||task.deleted)throw Object.assign(Error('这项任务已删除。'),{missingTask:true});
      return mutate(task);
    };
    if(!db){
      const tasks=memory[store],next=apply(clone(tasks.get(id)));
      if(next===null)tasks.delete(id);
      else tasks.set(id,clone(next));
      return next;
    }
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readwrite'),tasks=tx.objectStore(store),request=tasks.get(id);
      let next,error;
      request.onsuccess=()=>{
        try{
          next=apply(request.result);
          if(next===null)tasks.delete(id);
          else tasks.put(next);
        }catch(cause){error=cause;tx.abort();}
      };
      tx.oncomplete=()=>resolve(next);
      tx.onabort=tx.onerror=()=>reject(error||tx.error||Error('任务更新失败，请重试。'));
    });
  }
  function edit(id,etag,mutate,withSystem=false){
    const stale=()=>Error('这项任务已有新记录，请再次查看。');
    function apply(task,system){if(!task||task.etag!==etag)throw stale();mutate(task,system);task.etag++;task.updated=new Date().toISOString();return {task,system};}
    if(!db){
      const task=clone(memory.tasks.get(id)),chatId=task?.chatId;
      const pair=apply(task,clone(memory.system.get(chatId))||initial(chatId));
      memory.tasks.set(id,clone(pair.task));
      if(withSystem)memory.system.set(chatId,clone(pair.system));
      return Promise.resolve(pair);
    }
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['tasks','system'],'readwrite'),ts=tx.objectStore('tasks'),ss=tx.objectStore('system');
      const request=ts.get(id);
      let out,error;
      request.onsuccess=()=>{
        const task=request.result;
        if(!task){error=stale();tx.abort();return;}
        const ledger=ss.get(task.chatId);
        ledger.onsuccess=()=>{
          try{
            out=apply(task,ledger.result||initial(task.chatId));
            ts.put(out.task);
            if(withSystem)ss.put(out.system);
          }catch(cause){error=cause;tx.abort();}
        };
      };
      tx.oncomplete=()=>resolve(out);
      tx.onabort=tx.onerror=()=>reject(error||tx.error||Error('保存失败，请检查浏览器存储空间。'));
    });
  }
  root.DeskRecords={init,all,put,saveChat,removeChat,createIntake,updateIntake,removeSetupTask,withoutTaskMessages,createHandoff,editHandoff,changeTask,edit,initial,loadSystem,get temporary(){return temporary;}};
})(window);
