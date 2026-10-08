const express=require("express");
const crypto=require("crypto");
const fs=require("fs");
const path=require("path");

const app=express();

app.disable("x-powered-by");
app.use(express.json({limit:"64kb"}));

const DB_FILE=path.join(__dirname,"licenses.json");
const ADMIN_KEY=process.env.ADMIN_KEY||"";
const CORS=process.env.CORS_ORIGIN||"*";
const hits=new Map();

app.use((req,res,next)=>{
  res.setHeader("Access-Control-Allow-Origin",CORS);
  res.setHeader("Access-Control-Allow-Headers","Content-Type, X-Admin-Key");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");

  if(req.method==="OPTIONS") return res.sendStatus(204);

  next();
});

function load(){
  try{
    return JSON.parse(fs.readFileSync(DB_FILE,"utf8"));
  }catch{
    return {licenses:[]};
  }
}

function save(db){
  fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2));
}

function admin(req,res){
  if(!ADMIN_KEY) return true;

  if(String(req.get("X-Admin-Key")||"")!==ADMIN_KEY){
    res.status(401).json({
      error:"Seller authentication required"
    });
    return false;
  }

  return true;
}

function rate(req,res){
  const now=Date.now();
  const key=(req.ip||"unknown")+":"+req.path;
  const a=hits.get(key)||[];

  const fresh=a.filter(t=>now-t<60000);

  fresh.push(now);
  hits.set(key,fresh);

  if(fresh.length>60){
    res.status(429).json({
      error:"Too many requests"
    });
    return false;
  }

  return true;
}

app.get("/api/health",(req,res)=>{
  res.json({
    ok:true,
    service:"HTML Multitool Licensing Server",
    sellerAuthConfigured:!!ADMIN_KEY
  });
});

app.post("/api/licenses",(req,res)=>{
  if(!admin(req,res)||!rate(req,res)) return;

  const product=String(
    req.body.product||"HTML Product"
  ).slice(0,120);

  const buildId=String(
    req.body.buildId||""
  ).slice(0,80);

  const count=Math.max(
    1,
    Math.min(500,Number(req.body.count)||1)
  );

  const db=load();
  const licenses=[];

  for(let i=0;i<count;i++){

    const x={
      id:crypto.randomUUID(),

      product,

      buildId,

      code:
        "HTML-"+
        crypto.randomBytes(2)
          .toString("hex")
          .toUpperCase()+
        "-"+
        crypto.randomBytes(4)
          .toString("hex")
          .toUpperCase(),

      status:"UNUSED",

      created:new Date().toISOString(),

      activated:null,

      activationId:null,

      lastProduct:null,

      lastBuildId:null
    };

    db.licenses.push(x);
    licenses.push(x);
  }

  save(db);

  res.json({licenses});
});

app.post("/api/activate",(req,res)=>{

  if(!rate(req,res)) return;

  const code=String(
    req.body.code||""
  ).trim().toUpperCase();

  const activationId=String(
    req.body.activationId||""
  ).trim();

  const product=String(
    req.body.product||""
  ).trim();

  const buildId=String(
    req.body.buildId||""
  ).trim();

  if(!code||!activationId){

    return res.status(400).json({
      error:"code and activationId are required"
    });

  }

  const db=load();

  const x=db.licenses.find(
    v=>v.code===code
  );

  if(!x){

    return res.status(404).json({
      error:"License not found"
    });

  }

  if(x.status==="REVOKED"){

    return res.status(403).json({
      error:"License has been revoked"
    });

  }

  if(x.product!==product){

    return res.status(403).json({
      error:"License belongs to a different product"
    });

  }

  if(
    x.buildId &&
    buildId &&
    x.buildId!==buildId
  ){

    return res.status(403).json({
      error:"License is for a different build"
    });

  }

  if(
    x.status==="ACTIVE" &&
    x.activationId!==activationId
  ){

    return res.status(409).json({
      error:"License has already been activated"
    });

  }

  if(x.status==="UNUSED"){

    x.status="ACTIVE";

    x.activated=
      new Date().toISOString();

    x.activationId=activationId;

    x.lastProduct=product;

    x.lastBuildId=buildId;

    save(db);
  }

  res.json({
    ok:true,

    license:{
      id:x.id,
      product:x.product,
      buildId:x.buildId,
      status:x.status,
      activated:x.activated
    }
  });

});

app.post("/api/revoke",(req,res)=>{

  if(!admin(req,res)||!rate(req,res)) return;

  const db=load();

  const x=db.licenses.find(
    v=>v.id===String(req.body.id||"")
  );

  if(!x){

    return res.status(404).json({
      error:"License not found"
    });

  }

  x.status="REVOKED";

  save(db);

  res.json({ok:true});

});

app.get("/api/licenses",(req,res)=>{

  if(!admin(req,res)||!rate(req,res)) return;

  const db=load();

  res.json({
    licenses:db.licenses.map(x=>{

      const y={...x};

      delete y.activationId;

      return y;

    })
  });

});

const port=process.env.PORT||8787;

app.listen(port,()=>{
  console.log(
    "HTML Multitool licensing server listening on "+
    port
  );
});
