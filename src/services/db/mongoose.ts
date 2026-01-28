import mongoose from 'mongoose'
import { loadConfig } from '@/config/index.ts'

let connected = false

export const connectMongo = async (envOverride?: string) => {
  if (connected) return

  const config = loadConfig(envOverride)
  await mongoose.connect(config.mongo.uri)
  connected = true
}

export const disconnectMongo = async () => {
  if (!connected) return
  await mongoose.disconnect()
  connected = false
}
