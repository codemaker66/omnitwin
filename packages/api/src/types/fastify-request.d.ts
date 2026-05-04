import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
    __startHrTime?: bigint;
  }
}
