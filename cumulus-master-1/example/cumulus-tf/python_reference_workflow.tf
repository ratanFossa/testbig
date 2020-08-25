
resource "aws_sfn_activity" "ecs_task_python_processing_service" {
  name = "${var.prefix}-EcsTaskPythonProcess"
  tags = local.tags
}

module "python_processing_service" {
  source = "../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "PythonProcess"
  tags   = local.tags

  cluster_arn                           = module.cumulus.ecs_cluster_arn
  desired_count                         = 1
  image                                 = "cumuluss/cumulus-process-activity:1"
  log2elasticsearch_lambda_function_arn = module.cumulus.log2elasticsearch_lambda_function_arn

  cpu                = 400
  memory_reservation = 700

  environment = {
    AWS_DEFAULT_REGION = data.aws_region.current.name
    ACTIVITY_ARN = aws_sfn_activity.ecs_task_python_processing_service.id
  }
  command = [
    "/usr/local/bin/python",
    "process_activity.py"
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

module "python_reference_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "PythonReferenceWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/python_reference_workflow.asl.json",
    {
      python_reference_task_arn: aws_lambda_function.python_reference_task.arn,
      python_processing_service_id: aws_sfn_activity.ecs_task_python_processing_service.id
    }
  )
}
