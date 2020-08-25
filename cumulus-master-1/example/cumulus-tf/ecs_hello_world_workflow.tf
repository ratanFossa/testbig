resource "aws_sfn_activity" "ecs_task_hello_world" {
  name = "${var.prefix}-EcsTaskHelloWorld"
  tags = local.tags
}

module "hello_world_service" {
  source = "../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "HelloWorld"
  tags   = local.tags

  cluster_arn                           = module.cumulus.ecs_cluster_arn
  desired_count                         = 1
  image                                 = "cumuluss/cumulus-ecs-task:1.7.0"
  log2elasticsearch_lambda_function_arn = module.cumulus.log2elasticsearch_lambda_function_arn

  cpu                = 400
  memory_reservation = 700

  environment = {
    AWS_DEFAULT_REGION = data.aws_region.current.name
  }
  command = [
    "cumulus-ecs-task",
    "--activityArn",
    aws_sfn_activity.ecs_task_hello_world.id,
    "--lambdaArn",
    module.cumulus.hello_world_task.task_arn
  ]
  alarms = {
    TaskCountHigh = {
      comparison_operator = "GreaterThanThreshold"
      evaluation_periods  = 1
      metric_name         = "MemoryUtilization"
      statistic           = "SampleCount"
      threshold           = 1
    }
  }
}

module "ecs_hello_world_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "EcsHelloWorldWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags


  state_machine_definition = templatefile(
    "${path.module}/ecs_hello_world_workflow.asl.json",
    {
      ecs_task_hello_world_activity_id: aws_sfn_activity.ecs_task_hello_world.id
    }
  )
}
