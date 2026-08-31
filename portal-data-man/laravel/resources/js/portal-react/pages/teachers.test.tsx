import'@testing-library/jest-dom/vitest';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{render,screen}from'@testing-library/react';
import{MemoryRouter,Route,Routes}from'react-router-dom';
import{afterEach,describe,expect,it,vi}from'vitest';
import{ToastProvider}from'../components/management';
import{TeacherDetailPage}from'./teachers';

afterEach(()=>vi.restoreAllMocks());
describe('detail guru baru',()=>{it('tetap merender guru yang belum memiliki foto dan akun',async()=>{const json={'Content-Type':'application/json'};vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{const url=String(input);if(url.endsWith('/account'))return new Response(JSON.stringify({success:true,message:'Akun guru berhasil diambil.',data:null}),{status:200,headers:json});return new Response(JSON.stringify({success:true,message:'Guru berhasil diambil.',data:{publicId:'01GURU',fullName:'Muhammad Arif',nip:'17823782378237',status:'ACTIVE',photoPath:null,account:null,classes:[]}}),{status:200,headers:json})});const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><ToastProvider><MemoryRouter initialEntries={['/teachers/01GURU']}><Routes><Route path="/teachers/:id" element={<TeacherDetailPage/>}/></Routes></MemoryRouter></ToastProvider></QueryClientProvider>);expect(await screen.findByRole('heading',{name:'Muhammad Arif'})).toBeInTheDocument();expect(await screen.findByText('Akun belum dibuat')).toBeInTheDocument()})});
