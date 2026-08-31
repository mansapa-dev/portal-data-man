import{createHash}from'crypto';
import{SessionService}from'./session.service';

describe('SessionService CSRF rotation',()=>{it('stores only the new token hash',async()=>{const update=jest.fn().mockResolvedValue({}),service=new SessionService({authSession:{update}}as any);const token=await service.rotateCsrf(42n);expect(token).toMatch(/^[A-Za-z0-9_-]+$/);expect(update).toHaveBeenCalledWith({where:{id:42n},data:{csrfHash:createHash('sha256').update(token).digest('hex')}});expect(service.verifyCsrf(update.mock.calls[0][0].data.csrfHash,token)).toBe(true)})});
