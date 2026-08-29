import { Injectable } from '@nestjs/common'; import * as argon2 from 'argon2';
@Injectable() export class PasswordService { hash(value:string){return argon2.hash(value,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});} verify(hash:string,value:string){return argon2.verify(hash,value);} }
