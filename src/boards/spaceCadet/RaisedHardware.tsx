import { useFrame } from '@react-three/fiber'
import type { MeshStandardMaterial } from 'three'
import type { SpaceCadetGame } from './game'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, DoubleSide, ExtrudeGeometry, Shape, SRGBColorSpace, TubeGeometry, Vector3 } from 'three'
import { DECK_OUTLINE, DECK_RAILS, DECK_Y, ORBIT_CANOPY, RAMP_PATH, RAMP_WIDTH, type Vec2, type Vec3 } from './layout'

function polygonGeometry(points: readonly Vec2[], depth: number) {
  const shape = new Shape()
  points.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z))
  shape.closePath()
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .025, bevelThickness: .015, bevelSegments: 2 })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/** A solid elevated ribbon with side walls; the underside is open to ground balls. */
function ribbon(path: readonly Vec3[], width: number, wallHeight = .22) {
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = []
  const rims: Vector3[][] = [[], []]
  let distance = 0
  path.forEach(([x,y,z], i) => {
    if (i) distance += Math.hypot(x-path[i-1][0],z-path[i-1][2])
    const before = path[Math.max(0,i-1)], after = path[Math.min(path.length-1,i+1)]
    const dx = after[0]-before[0], dz = after[2]-before[2], length = Math.hypot(dx,dz)
    const sx = -dz/length*width/2, sz = dx/length*width/2
    vertices.push(x-sx,y+.065,z-sz, x+sx,y+.065,z+sz)
    uvs.push(0,distance/width, 1,distance/width)
    rims[0].push(new Vector3(x-sx,y+.065+wallHeight,z-sz))
    rims[1].push(new Vector3(x+sx,y+.065+wallHeight,z+sz))
    if (i < path.length-1) indices.push(i*2,i*2+2,i*2+1,i*2+1,i*2+2,i*2+3)
  })
  const floor = new BufferGeometry()
  floor.setAttribute('position',new BufferAttribute(new Float32Array(vertices),3))
  floor.setAttribute('uv',new BufferAttribute(new Float32Array(uvs),2)); floor.setIndex(indices); floor.computeVertexNormals()
  const walls = rims.map(points => {
    const pos: number[] = [], idx: number[] = []
    points.forEach((p,i) => {
      pos.push(p.x,p.y-wallHeight-.05,p.z,p.x,p.y,p.z)
      if (i < points.length-1) idx.push(i*2,i*2+1,i*2+2,i*2+1,i*2+3,i*2+2)
    })
    const g = new BufferGeometry(); g.setAttribute('position',new BufferAttribute(new Float32Array(pos),3)); g.setIndex(idx); g.computeVertexNormals(); return g
  })
  const rails = rims.map(p => new TubeGeometry(new CatmullRomCurve3(p),path.length*2,.023,8,false))
  return { floor, walls, rails }
}

function rampTexture() {
  const canvas = document.createElement('canvas'); canvas.width=256; canvas.height=2048
  const ctx=canvas.getContext('2d')!
  ctx.fillStyle='#8b70b5'; ctx.fillRect(0,0,256,2048)
  for(let y=0;y<2048;y+=128) {
    ctx.beginPath(); ctx.moveTo(0,y+90); ctx.lineTo(128,y); ctx.lineTo(256,y+90)
    ctx.lineTo(256,y+128); ctx.lineTo(128,y+42); ctx.lineTo(0,y+128); ctx.closePath()
    ctx.fillStyle='#b9b4d3'; ctx.fill()
  }
  const texture=new CanvasTexture(canvas); texture.colorSpace=SRGBColorSpace
  // Ribbon UVs are distances; scale the artwork to the actual ramp length.
  texture.repeat.y=.12; texture.anisotropy=8
  return texture
}

export function LaunchRamp() {
  const geometry=useMemo(()=>ribbon(RAMP_PATH,RAMP_WIDTH),[])
  const texture=useMemo(rampTexture,[])
  useEffect(()=>()=>{ geometry.floor.dispose(); geometry.walls.forEach(g=>g.dispose()); geometry.rails.forEach(g=>g.dispose()); texture.dispose() },[geometry,texture])
  return <group>
    <mesh geometry={geometry.floor} castShadow receiveShadow><meshStandardMaterial map={texture} color="#ddd3ef" side={DoubleSide} roughness={.42}/></mesh>
    {geometry.walls.map((g,i)=><mesh key={i} geometry={g} castShadow receiveShadow><meshStandardMaterial color="#72618e" side={DoubleSide} roughness={.4}/></mesh>)}
    {geometry.rails.map((g,i)=><mesh key={i} geometry={g}><meshStandardMaterial color="#d3d6de" metalness={.65} roughness={.26}/></mesh>)}
  </group>
}

export function LaunchDeck({ game }: { game: SpaceCadetGame }) {
  const lamps = useRef<(MeshStandardMaterial | null)[]>([])
  useFrame(() => lamps.current.forEach((m, i) => { if (m) m.emissiveIntensity = game.engineLit[i] ? 1.8 : .04 }))
  const floor=useMemo(()=>polygonGeometry(DECK_OUTLINE,.1),[])
  const rails=useMemo(()=>DECK_RAILS.map(s=>{
    const g=polygonGeometry([s.a,s.b,[s.b[0]+.035,s.b[1]+.015],[s.a[0]+.035,s.a[1]+.015]],.25)
    return g
  }),[])
  useEffect(()=>()=>{floor.dispose();rails.forEach(g=>g.dispose())},[floor,rails])
  return <group>
    <mesh geometry={floor} position={[0,DECK_Y-.035,0]} castShadow receiveShadow><meshStandardMaterial color="#a68ac6" roughness={.48}/></mesh>
    {rails.map((g,i)=><mesh key={i} geometry={g} position={[0,DECK_Y,0]} castShadow><meshStandardMaterial color="#6e5797" roughness={.38}/></mesh>)}
    {[-3.0,-2.57,-2.14].map((x,i)=><group key={x} position={[x,DECK_Y+.095,-.32]}>
      <mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.08,.105,24]}/><meshStandardMaterial color="#eedeb0"/></mesh>
      <mesh rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.078,24]}/><meshStandardMaterial ref={m => { lamps.current[i] = m }} color="#e9b42e" emissive="#e9b42e" emissiveIntensity={.2}/></mesh>
    </group>)}
    <mesh position={[-2.56,DECK_Y+.095,1.55]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.22,3]}/><meshStandardMaterial color="#e3ccec"/></mesh>
  </group>
}

export function OrbitCanopy() {
  const parts=useMemo(()=>{
    const curve=new CatmullRomCurve3(ORBIT_CANOPY.map(p=>new Vector3(...p)))
    const path=curve.getPoints(100)
    const sidePaths=[-.29,.29].map(offset=>path.map((p,i):Vec3=>{
      const tangent=curve.getTangent(i/100)
      return [p.x-tangent.z*offset,p.y,p.z+tangent.x*offset]
    }))
    return { strips:sidePaths.map(p=>ribbon(p,.23,.035)), braces:[0,.16,.33,.5,.67,.84,1].map(t=>({p:curve.getPoint(t),angle:Math.atan2(-curve.getTangent(t).z,curve.getTangent(t).x)})) }
  },[])
  useEffect(()=>()=>parts.strips.forEach(s=>{s.floor.dispose();s.walls.forEach(g=>g.dispose());s.rails.forEach(g=>g.dispose())}),[parts])
  return <group>
    {parts.strips.map((s,i)=><group key={i}>
      <mesh geometry={s.floor} castShadow><meshStandardMaterial color="#452b37" side={DoubleSide} roughness={.48}/></mesh>
      {s.walls.map((g,j)=><mesh key={j} geometry={g}><meshStandardMaterial color="#bc414c" side={DoubleSide}/></mesh>)}
      {s.rails.map((g,j)=><mesh key={j} geometry={g}><meshStandardMaterial color="#b84047" roughness={.4}/></mesh>)}
    </group>)}
    {parts.braces.map(({p,angle},i)=><mesh key={i} position={[p.x,p.y+.09,p.z]} rotation={[0,angle+Math.PI/2,0]} castShadow>
      <boxGeometry args={[.74,.07,.1]}/><meshStandardMaterial color={i===0 || i===6 ? '#be5050':'#224ba1'} roughness={.36}/>
    </mesh>)}
  </group>
}

/** Burgundy shields sit behind the yellow target banks. */
export function TargetShields() {
  const shapes=useMemo(()=>[
    polygonGeometry([[-1.89,-4.43],[-1.86,-5.18],[-1.51,-5.48],[-.93,-4.96],[-.82,-4.66]],.12),
    polygonGeometry([[-.68,-1.47],[-.56,-2.06],[.2,-2.17],[.47,-1.37]],.12),
  ],[])
  useEffect(()=>()=>shapes.forEach(g=>g.dispose()),[shapes])
  return <group>{shapes.map((g,i)=><group key={i}>
    <mesh geometry={g} position={[0,.28,0]} castShadow><meshStandardMaterial color="#4a303e" roughness={.38}/></mesh>
    <mesh geometry={g} position={[0,.255,0]}><meshStandardMaterial color="#e9dcc7" roughness={.4}/></mesh>
  </group>)}</group>
}
