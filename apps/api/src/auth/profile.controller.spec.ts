import{ProfileController}from'./profile.controller';

describe('ProfileController atomic password change',()=>{
 const user={id:1n,publicId:'01ADMIN00000000000000000',passwordHash:'old-hash'};
 const dto={currentPassword:'PasswordLama123',newPassword:'PasswordBaru456',newPasswordConfirmation:'PasswordBaru456'};
 const req={user,ip:'127.0.0.1',get:()=> 'jest'};
 const prepared={token:'new-token',csrf:'new-csrf',data:{publicId:'01SESSION000000000000000',secretHash:'secret-hash',csrfHash:'csrf-hash',expiresAt:new Date()}};
 function setup(fail?:'update'|'revoke'|'create'|'audit'){
  const state={password:'old-hash',revoked:false,created:false,audit:false};
  const tx={
   adminUser:{update:jest.fn(async()=>{if(fail==='update')throw new Error('update');state.password='new-hash'})},
   authSession:{
    updateMany:jest.fn(async()=>{if(fail==='revoke')throw new Error('revoke');state.revoked=true}),
    create:jest.fn(async()=>{if(fail==='create')throw new Error('create');state.created=true}),
   },
   auditLog:{create:jest.fn(async()=>{if(fail==='audit')throw new Error('audit');state.audit=true})},
  };
  const db={$transaction:jest.fn(async(callback:(client:typeof tx)=>Promise<unknown>)=>{const snapshot={...state};try{return await callback(tx)}catch(error){Object.assign(state,snapshot);throw error}})};
  const passwords={verify:jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),hash:jest.fn().mockResolvedValue('new-hash')};
  const sessions={prepare:jest.fn(()=>prepared),revokeAll:jest.fn(async(_:bigint,client:typeof tx)=>client.authSession.updateMany()),persist:jest.fn(async(client:typeof tx)=>client.authSession.create())};
  const audit={write:jest.fn(async(_:unknown,client:typeof tx)=>client.auditLog.create())};
  const res={cookie:jest.fn(),clearCookie:jest.fn()};
  return{controller:new ProfileController(db as any,passwords as any,sessions as any,audit as any),state,res};
 }
 it('commit menerbitkan cookie hanya setelah seluruh mutation berhasil',async()=>{const x=setup();await x.controller.change(dto as any,req as any,x.res as any);expect(x.state).toEqual({password:'new-hash',revoked:true,created:true,audit:true});expect(x.res.cookie).toHaveBeenCalledTimes(2)});
 it.each(['update','revoke','create','audit']as const)('kegagalan %s rollback seluruh state dan tidak menerbitkan cookie',async point=>{const x=setup(point);await expect(x.controller.change(dto as any,req as any,x.res as any)).rejects.toThrow(point);expect(x.state).toEqual({password:'old-hash',revoked:false,created:false,audit:false});expect(x.res.cookie).not.toHaveBeenCalled()});
});
